import { describe, expect, it } from 'vitest';
import { RefreshService } from './refresh.js';
import { autoInput, FakeBrowser, input, temporaryStore } from './test-utils.js';
import { NOT_APPLIED_MESSAGE, type Connection, type QueryResult } from '../shared/model.js';

describe('refresh jobs', () => {
  it('marks an active task interrupted during graceful shutdown and preserves completed progress', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    let resolveQuery!: (result: QueryResult) => void;
    browser.query = () =>
      new Promise((resolve) => {
        resolveQuery = resolve;
      });
    try {
      const app = store.create(autoInput());
      store.applyStatus(app.id, '一面', 'auto');
      service.start();
      service.stop();
      resolveQuery({ kind: 'expired', message: 'closing' });
      await service.wait();
      expect(store.runs()[0].state).toBe('interrupted');
      expect(store.application(app.id).rawStatus).toBe('一面');
      expect(store.application(app.id).checkState).toBe('ok');
    } finally {
      store.close();
      remove();
    }
  });
  it('queries each shared connection once, excludes manual records, and retains change counts after marking read', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    try {
      const first = store.create(autoInput());
      const second = store.create(autoInput({ position: '后端' }));
      store.create(input());
      service.bind(first.id, { id: 'first', position: '前端', batch: '', rawStatus: '初筛' });
      service.bind(second.id, { id: 'second', position: '后端', batch: '', rawStatus: '初筛' });
      browser.result = {
        kind: 'success',
        applications: [
          { id: 'first', position: '前端', batch: '', rawStatus: '一面' },
          { id: 'second', position: '后端', batch: '', rawStatus: '初筛' },
        ],
      };
      const run = service.start();
      expect(service.start().id).toBe(run.id);
      await service.wait();
      expect(browser.calls).toHaveLength(1);
      expect(store.runs()[0].applicationIds).toHaveLength(2);
      expect(store.runs()[0].changedIds).toEqual([first.id]);
      store.markRead(first.id);
      expect(store.runs()[0].changedIds).toEqual([first.id]);
      const next = service.start();
      await service.wait();
      expect(store.runs()[0].id).toBe(next.id);
      expect(store.runs()[0].changedIds).toEqual([]);
    } finally {
      store.close();
      remove();
    }
  });
  it('refreshes a chosen set of companies without opening the others', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    try {
      const first = store.create(
        autoInput({ company: '甲', url: 'https://a.jobs.feishu.cn/campus/position/application' }),
      );
      const second = store.create(
        autoInput({ company: '乙', url: 'https://b.jobs.feishu.cn/campus/position/application' }),
      );
      browser.result = { kind: 'success', applications: [] };
      const one = service.start([first.id]);
      await service.wait();
      expect(one.scope).toBe('single');
      expect(browser.calls).toEqual([first.connectionId]);
      const batch = service.start([first.id, second.id]);
      await service.wait();
      expect(batch.scope).toBe('selected');
      expect(browser.calls.slice(1).sort()).toEqual(
        [first.connectionId, second.connectionId].sort(),
      );
    } finally {
      store.close();
      remove();
    }
  });
  it('limits simultaneous connections to three and isolates connection failures', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    let concurrent = 0,
      maximum = 0;
    browser.query = async (connection: Connection): Promise<QueryResult> => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 15));
      concurrent--;
      if (connection.name === '公司0') throw new Error('network');
      return { kind: 'expired', message: '需补登' };
    };
    try {
      for (let i = 0; i < 5; i++)
        store.create(
          autoInput({
            company: `公司${i}`,
            url: `https://site${i}.jobs.feishu.cn/campus/position/application`,
          }),
        );
      service.start();
      await service.wait();
      const run = store.runs()[0];
      expect(maximum).toBe(3);
      expect(run.state).toBe('completed');
      expect(Object.values(run.outcomes).filter((v) => v === 'error')).toHaveLength(1);
      expect(Object.values(run.outcomes).filter((v) => v === 'expired')).toHaveLength(4);
    } finally {
      store.close();
      remove();
    }
  });
  it('never guesses a job without explicit binding and preserves progress on missing matches', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    try {
      const app = store.create(autoInput({ position: '未匹配岗位' }));
      service.start();
      await service.wait();
      expect(store.application(app.id).checkState).toBe('unmatched');
      expect(store.application(app.id).rawStatus).toBe('');
      service.bind(app.id, { id: 'deleted-job', position: '前端', batch: '', rawStatus: '二面' });
      service.start(app.id);
      await service.wait();
      expect(store.application(app.id).rawStatus).toBe('二面');
      expect(store.application(app.id).checkState).toBe('unmatched');
      expect(() =>
        service.bind(app.id, { id: 'other-job', position: '后端', batch: '', rawStatus: '初筛' }),
      ).toThrow('不能切换');
    } finally {
      store.close();
      remove();
    }
  });
  it('keeps a logged-in company with no current-cohort application instead of asking to reconnect', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    try {
      const app = store.create(
        autoInput({ company: '阿里巴巴', position: '待确认岗位' }),
      );
      browser.result = {
        kind: 'success',
        applications: [
          { id: 'intern', position: '开发', batch: '2027届实习', rawStatus: '已投递' },
        ],
      };
      service.start(app.id);
      await service.wait();
      expect(store.applications()).toHaveLength(1);
      expect(store.application(app.id).externalId).toBeNull();
      expect(store.application(app.id).checkState).toBe('ok');
      expect(store.application(app.id).checkMessage).toBe(NOT_APPLIED_MESSAGE);
      expect(store.runs()[0].outcomes[app.id]).toBe('ok');
    } finally {
      store.close();
      remove();
    }
  });
  it('still reads an unverified company on the schedule, and skips one that is actually logged out', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    try {
      const open = store.create(
        autoInput({ company: '腾讯', url: 'https://join.qq.com/progress.html' }),
      );
      const closed = store.create(
        autoInput({
          company: '已过期',
          url: 'https://closed.jobs.feishu.cn/campus/position/application',
        }),
      );
      store.setCheck(closed.id, 'expired', '登录已失效');
      store.saveConnection({
        ...store.connection(closed.connectionId!),
        pauseReason: 'expired',
      });
      service.start(undefined, 'scheduled');
      await service.wait();
      expect(browser.calls).toEqual([open.connectionId]);
      expect(store.runs()[0].outcomes[closed.id]).toBe('skipped');
      expect(store.runs()[0].outcomes[open.id]).not.toBe('skipped');
    } finally {
      store.close();
      remove();
    }
  });
  it('skips a company only after every automatic application is rejected', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    const url = 'https://xiaopeng.jobs.feishu.cn/398875/position/application';
    try {
      const closed = store.create(autoInput({ company: '小鹏汽车', position: '志愿一', url }));
      const open = store.create(autoInput({ company: '小鹏汽车', position: '志愿二', url }));
      store.create(autoInput({ company: '小鹏汽车', position: '志愿三', url }));
      store.applyStatus(closed.id, '简历不通过', 'manual');
      service.bind(open.id, { id: 'open', position: '志愿二', batch: '', rawStatus: '初筛' });
      browser.result = {
        kind: 'success',
        applications: [{ id: 'open', position: '志愿二', batch: '', rawStatus: '一面' }],
      };
      service.start();
      await service.wait();
      expect(browser.calls).toHaveLength(1);
      expect(store.application(open.id).rawStatus).toBe('一面');

      store.applyStatus(open.id, '流程结束', 'manual');
      for (const app of store.applications())
        if (app.stage !== 'rejected') store.applyStatus(app.id, '已淘汰', 'manual');
      const finished = store.create(
        autoInput({
          company: '荣耀',
          url: 'https://career.honor.com/account',
        }),
      );
      service.bind(finished.id, { id: 'honor', position: '软件', batch: '', rawStatus: '初筛' });
      browser.calls.length = 0;
      browser.result = {
        kind: 'success',
        applications: [{ id: 'honor', position: '软件', batch: '', rawStatus: '笔试' }],
      };
      service.start();
      await service.wait();
      expect(browser.calls).toEqual([store.application(finished.id).connectionId]);
      expect(store.application(finished.id).rawStatus).toBe('笔试');
      expect(store.runs()[0].outcomes[closed.id]).toBe('skipped');
    } finally {
      store.close();
      remove();
    }
  });
  it('skips records deleted during a query without crashing the task', async () => {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const service = new RefreshService(store, browser);
    let resolveQuery!: (result: QueryResult) => void;
    browser.query = () =>
      new Promise((resolve) => {
        resolveQuery = resolve;
      });
    try {
      const app = store.create(autoInput());
      const run = service.start();
      store.remove(app.id);
      resolveQuery({ kind: 'success', applications: [] });
      await service.wait();
      expect(store.runs()[0].outcomes[app.id]).toBe('skipped');
      expect(store.runs()[0].id).toBe(run.id);
    } finally {
      store.close();
      remove();
    }
  });
});
