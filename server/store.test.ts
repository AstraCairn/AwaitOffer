import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { classifyStatus, hasUnread, NOT_APPLIED_MESSAGE } from '../shared/model.js';
import { autoInput, input, temporaryStore } from './test-utils.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function setup() {
  const temporary = temporaryStore();
  cleanups.push(() => {
    try {
      temporary.store.close();
    } catch {}
    temporary.remove();
  });
  return temporary;
}
describe('persistent application state', () => {
  it('classifies a literal new application as screening while keeping an unconfirmed hiring evaluation unclassified', () => {
    expect(classifyStatus('新投递')).toBe('screening');
    expect(classifyStatus('评估中')).toBe('screening');
    expect(classifyStatus('录用评估中')).toBe('unknown');
    expect(classifyStatus('暂不匹配')).toBe('rejected');
  });
  it('reclassifies stored 评估中 and 暂不匹配, and keeps a Moka delivery date', () => {
    const { store, path } = setup();
    const screening = store.create(input({ rawStatus: '评估中' }));
    const ended = store.create(input({ company: '米哈游', rawStatus: '暂不匹配', url: 'https://jobs.mihoyo.com/apply' }));
    store.saveApplication({
      ...store.application(screening.id),
      stage: 'unknown',
      externalId: 'moka-delivery:["Agent 工程师","2026-09-22"]',
    });
    store.saveApplication({
      ...store.application(ended.id),
      stage: 'unknown',
      checkState: 'error',
      checkMessage: '官网查询失败，已有进度已保留。',
    });
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.application(screening.id).stage).toBe('screening');
      expect(reopened.application(screening.id).appliedAt).toBe('2026-09-22');
      expect(reopened.application(ended.id).stage).toBe('rejected');
      expect(reopened.application(ended.id).checkState).toBe('ok');
      expect(reopened.application(ended.id).checkMessage).toBe('');
    } finally {
      reopened.close();
    }
  });
  it('repairs a verified empty login that was stored as an unmatched cohort', () => {
    const { store, path } = setup();
    const app = store.create(autoInput({ company: '阿里巴巴', position: '待确认岗位' }));
    store.saveConnection({
      ...store.connection(app.connectionId!),
      verifiedAt: '2026-10-19T00:00:00.000Z',
    });
    store.setCheck(
      app.id,
      'unmatched',
      '官网记录已读取，但没有符合当前届别规则的岗位可关联此入口。',
    );
    const keep = store.create(
      autoInput({
        company: '已有岗位',
        position: '未匹配岗位',
        url: 'https://other.jobs.feishu.cn/campus/position/application',
      }),
    );
    store.saveConnection({
      ...store.connection(keep.connectionId!),
      verifiedAt: '2026-10-19T00:00:00.000Z',
    });
    store.setCheck(keep.id, 'unmatched', '连接成功，请选择对应的官网投递。');
    store.close();
    const reopened = new Store(path);
    expect(reopened.application(app.id).checkState).toBe('ok');
    expect(reopened.application(app.id).checkMessage).toBe(NOT_APPLIED_MESSAGE);
    expect(reopened.application(keep.id).checkState).toBe('unmatched');
    reopened.close();
  });
  it('records a manual baseline without unread and persists across restart', () => {
    const { store, path } = setup();
    const app = store.create(input());
    expect(store.history(app.id)).toHaveLength(1);
    expect(hasUnread(app)).toBe(false);
    store.close();
    const reopened = new Store(path);
    expect(reopened.application(app.id).rawStatus).toBe('简历初筛');
    reopened.close();
  });
  it('establishes an automatic baseline, then detects wording changes within the same stage', () => {
    const { store } = setup();
    const app = store.create(autoInput());
    expect(store.history(app.id)).toHaveLength(0);
    expect(store.applyStatus(app.id, ' 简历初筛 ', 'auto', '2026-10-01T00:00:00.000Z')).toBe(false);
    expect(store.application(app.id).sinceKnown).toBe(false);
    expect(store.applyStatus(app.id, '简历  初筛', 'auto')).toBe(true);
    expect(store.application(app.id).stage).toBe('screening');
    expect(hasUnread(store.application(app.id))).toBe(true);
  });
  it('does not add history or reset the clock when status is unchanged', () => {
    const { store } = setup();
    const app = store.create(input());
    const since = app.stateSince;
    store.applyStatus(app.id, '\n简历初筛 \n', 'auto');
    expect(store.history(app.id)).toHaveLength(1);
    expect(store.application(app.id).stateSince).toBe(since);
    expect(store.application(app.id).lastCheckedAt).not.toBeNull();
  });
  it('preserves unread changes through unchanged refreshes and permits another unread update after reading', () => {
    const { store } = setup();
    const app = store.create(input());
    store.applyStatus(app.id, '一面', 'auto');
    const change = store.application(app.id).lastChangeId;
    store.applyStatus(app.id, '一面', 'auto');
    expect(store.application(app.id).lastChangeId).toBe(change);
    expect(hasUnread(store.application(app.id))).toBe(true);
    store.markRead(app.id);
    expect(hasUnread(store.application(app.id))).toBe(false);
    store.applyStatus(app.id, '二面', 'auto');
    expect(hasUnread(store.application(app.id))).toBe(true);
    expect(store.history(app.id)).toHaveLength(3);
  });
  it.each(['expired', 'challenge', 'error', 'unmatched'] as const)(
    'preserves progress after %s',
    (state) => {
      const { store } = setup();
      const app = store.create(input());
      store.setCheck(app.id, state, '查询失败');
      expect(store.application(app.id).rawStatus).toBe(app.rawStatus);
      expect(store.application(app.id).stateSince).toBe(app.stateSince);
      expect(store.history(app.id)).toHaveLength(1);
    },
  );
  it('editing metadata or overriding a stage does not reset raw-status time', () => {
    const { store } = setup();
    const app = store.create(input());
    store.edit(app.id, input({ company: '新名称', stageOverride: 'pool' }));
    expect(store.application(app.id).stateSince).toBe(app.stateSince);
    expect(store.history(app.id)).toHaveLength(1);
    store.applyStatus(app.id, '一面', 'auto');
    expect(store.application(app.id).stage).toBe('pool');
  });
  it('updates manual website and platform metadata without resetting existing progress', () => {
    const { store } = setup();
    const app = store.create(input());
    store.edit(
      app.id,
      input({ url: 'https://campus.example.com/#/myDeliver', platform: 'beisen' }),
    );
    const updated = store.application(app.id);
    expect(updated.url).toBe('https://campus.example.com/#/myDeliver');
    expect(updated.platform).toBe('beisen');
    expect(updated.stateSince).toBe(app.stateSince);
    expect(store.history(app.id)).toHaveLength(1);
  });
  it('supports blank imported records and manual changes in history', () => {
    const { store } = setup();
    const app = store.create(input({ rawStatus: '' }));
    store.edit(app.id, input({ rawStatus: '', position: '后端' }));
    expect(store.history(app.id)).toHaveLength(0);
    store.edit(app.id, input({ rawStatus: '笔试' }));
    store.edit(app.id, input({ rawStatus: '一面' }));
    expect(store.history(app.id)[0].source).toBe('manual');
    expect(() => store.edit(app.id, input({ rawStatus: '' }))).toThrow('不能清空');
  });
  it('uses one site connection for multiple application records', () => {
    const { store } = setup();
    const first = store.create(autoInput());
    const second = store.create(autoInput({ position: '后端' }));
    expect(first.id).not.toBe(second.id);
    expect(first.connectionId).toBe(second.connectionId);
    expect(store.connections()).toHaveLength(1);
  });
  it('converts an empty bookmark to automatic mode without changing its record id', () => {
    const { store } = setup();
    const app = store.create(input({ url: autoInput().url, rawStatus: '', platform: 'feishu' }));
    const converted = store.enableAuto(app.id);
    expect(converted.id).toBe(app.id);
    expect(converted.mode).toBe('auto');
    expect(store.applications()).toHaveLength(1);
    expect(converted.connectionId).not.toBeNull();
  });
  it('deletes all corresponding history', () => {
    const { store } = setup();
    const app = store.create(input());
    store.applyStatus(app.id, '一面', 'manual');
    store.remove(app.id);
    expect(store.history(app.id)).toHaveLength(0);
  });
  it('marks unfinished runs interrupted at startup', () => {
    const { store, path } = setup();
    const id = randomUUID();
    store.saveRun({
      id,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      applicationIds: [],
      changedIds: [],
      outcomes: {},
    });
    store.close();
    const reopened = new Store(path);
    expect(reopened.runs()[0].state).toBe('interrupted');
    reopened.close();
  });
});
describe('backup restore', () => {
  it('roundtrips records and unread history, saves old data, and forces new login profiles', () => {
    const { store, path } = setup();
    const app = store.create(autoInput());
    store.applyStatus(app.id, '初筛', 'auto');
    store.applyStatus(app.id, '一面', 'auto');
    const backup = store.exportBackup();
    expect(JSON.stringify(backup)).not.toMatch(/cookies|password|storageState/);
    const connectionId = app.connectionId;
    store.restore(backup);
    expect(store.application(app.id).connectionId).not.toBe(connectionId);
    expect(store.application(app.id).checkState).toBe('expired');
    expect(hasUnread(store.application(app.id))).toBe(true);
    expect(store.history(app.id)).toHaveLength(2);
    expect(existsSync(join(path, 'backups'))).toBe(true);
    expect(readdirSync(join(path, 'backups'))).toHaveLength(1);
  });
  it.each(['version', 'reference', 'duplicate', 'partial'] as const)(
    'rejects invalid %s backups without changing current records',
    (kind) => {
      const { store } = setup();
      const app = store.create(input());
      const backup = store.exportBackup();
      const value: any = structuredClone(backup);
      if (kind === 'version') value.version = 999;
      if (kind === 'reference') value.history[0].applicationId = randomUUID();
      if (kind === 'duplicate') value.applications.push(value.applications[0]);
      if (kind === 'partial') delete value.applications[0].company;
      expect(() => store.restore(value)).toThrow();
      expect(store.application(app.id).rawStatus).toBe('简历初筛');
    },
  );
});
describe('startup recover', () => {
  it('merges a JD DOM duplicate into the numeric delivery id and ignores the DOM id', () => {
    const { store, path } = setup();
    const keep = store.create(
      autoInput({
        company: '京东',
        position: '后端开发工程师',
        url: 'https://campus.jd.com/#/myDeliver',
      }),
    );
    const extra = store.create(
      autoInput({
        company: '京东',
        position: '后端开发工程师',
        url: 'https://campus.jd.com/#/myDeliver',
      }),
    );
    store.applyStatus(keep.id, '笔试中', 'auto');
    store.saveApplication({
      ...store.application(keep.id),
      externalId: '4261266',
      checkState: 'unmatched',
      checkMessage: '官网投递已找不到或无法唯一匹配，请重新选择投递。',
    });
    store.applyStatus(extra.id, '笔试中', 'auto');
    store.applyStatus(extra.id, '简历筛选中', 'auto');
    store.saveApplication({
      ...store.application(extra.id),
      externalId: 'jd-dom:["后端开发工程师","秋招正式批"]',
    });
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.applications()).toHaveLength(1);
      const merged = reopened.application(keep.id);
      expect(merged.externalId).toBe('4261266');
      expect(merged.rawStatus).toBe('简历筛选中');
      expect(merged.stage).toBe('screening');
      expect(reopened.history(keep.id).some((item) => item.toStatus === '简历筛选中')).toBe(true);
      expect(
        reopened
          .ignored()
          .some((item) => item.externalId === 'jd-dom:["后端开发工程师","秋招正式批"]'),
      ).toBe(true);
      expect(() => reopened.application(extra.id)).toThrow('投递记录不存在');
    } finally {
      reopened.close();
    }
  });
  it('rewrites a stored Moka thanks page, converts auto-capable placeholders, and leaves self-built hosts manual', () => {
    const { store, path } = setup();
    const moka = store.create(
      input({
        company: '途虎养车',
        url: 'https://app.mokahr.com/campus-recruitment/tuhu/41112',
        rawStatus: '',
        platform: 'moka',
      }),
    );
    store.saveApplication({
      ...store.application(moka.id),
      url: 'https://app.mokahr.com/campus-recruitment/tuhu/41112#/job/abc/campus_apply/thanks',
    });
    const feishu = store.create(
      input({
        company: '小马智行',
        url: 'https://ponyai.jobs.feishu.cn/campus/position/application',
        rawStatus: '',
        platform: 'manual',
      }),
    );
    const lixiang = store.create(
      input({
        company: '理想汽车',
        url: 'https://www.lixiang.com/campus',
        rawStatus: '',
        platform: 'manual',
      }),
    );
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.application(moka.id).url).toContain('#/candidateHome/applications');
      expect(reopened.application(moka.id).mode).toBe('auto');
      expect(reopened.application(moka.id).platform).toBe('moka');
      expect(reopened.application(feishu.id).mode).toBe('auto');
      expect(reopened.application(feishu.id).platform).toBe('feishu');
      expect(reopened.application(lixiang.id).mode).toBe('manual');
    } finally {
      reopened.close();
    }
  });
  it('marks existing rejected unread rows as read on startup', () => {
    const { store, path } = setup();
    const app = store.create(input());
    store.applyStatus(app.id, '一面', 'auto');
    store.saveApplication({
      ...store.application(app.id),
      rawStatus: '不合适',
      stage: 'rejected',
    });
    expect(hasUnread(store.application(app.id))).toBe(true);
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.application(app.id).stage).toBe('rejected');
      expect(hasUnread(reopened.application(app.id))).toBe(false);
    } finally {
      reopened.close();
    }
  });
  it('auto-reads a newly recorded rejected change and supports marking every unread row', () => {
    const { store } = setup();
    const first = store.create(input());
    const second = store.create(input({ company: '另一家' }));
    store.applyStatus(first.id, '一面', 'auto');
    store.applyStatus(second.id, '二面', 'auto');
    expect(hasUnread(store.application(first.id))).toBe(true);
    store.applyStatus(first.id, '不合适', 'auto');
    expect(store.application(first.id).stage).toBe('rejected');
    expect(hasUnread(store.application(first.id))).toBe(false);
    expect(hasUnread(store.application(second.id))).toBe(true);
    store.markAllRead();
    expect(hasUnread(store.application(second.id))).toBe(false);
  });
});
describe('stage classification', () => {
  it.each([
    ['面试未通过', 'rejected'],
    ['人才库', 'rejected'],
    ['OC', 'resolved'],
    ['Offer 已发放', 'resolved'],
    ['业务复试', 'interview'],
    ['候补', 'pool'],
    ['录用评估中', 'unknown'],
    ['评估中', 'screening'],
    ['暂不匹配', 'rejected'],
    ['笔试中', 'assessment'],
    ['考试&测评 - 已完成', 'assessment'],
    ['简历初筛-进行中', 'screening'],
    ['待处理简历', 'screening'],
    ['笔试通过，简历筛选中', 'screening'],
    ['简历筛选通过，待笔试', 'assessment'],
    ['面试已结束', 'interview'],
    ['流程已结束，简历共享中', 'rejected'],
  ])('classifies %s as %s', (raw, stage) => expect(classifyStatus(raw)).toBe(stage));
});
