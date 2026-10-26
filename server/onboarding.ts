import { NOT_APPLIED_MESSAGE, type OnboardingState } from '../shared/model.js';
import { Store } from './store.js';
import type { BrowserQueries } from './browser.js';

/** Passive checks never reload a page while the user enters their credentials. */
export class Onboarding {
  state: OnboardingState = { active: false, currentId: null, queue: [], results: [], message: '' };
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  private stopped = false;
  private epoch = 0;
  constructor(
    private store: Store,
    private browser: BrowserQueries,
  ) {}
  async start(ids: string[]) {
    if (this.state.active) {
      if (ids.every((id) => id === this.state.currentId || this.state.queue.includes(id)))
        return this.state;
      throw new Error('已有官网等待登录，请先完成、跳过或暂停当前连接。');
    }
    this.epoch = (this.epoch ?? 0) + 1;
    this.stopped = false;
    this.state = {
      active: true,
      currentId: null,
      queue: [...new Set(ids)],
      results: [],
      message: '',
    };
    await this.next();
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.check();
      }, 5000);
      this.timer.unref();
    }
    return this.state;
  }
  private async next() {
    if (this.stopped || !this.state.active) return;
    const id = this.state.queue.shift();
    if (!id) {
      this.state.active = false;
      this.state.currentId = null;
      this.state.message = '本轮连接已结束，可查看录入结果。';
      return;
    }
    this.state.currentId = id;
    const c = this.store.connection(id);
    this.state.message = `请在 ${c.name} 的 Edge 窗口登录并进入投递记录；系统会自动读取。`;
    for (const a of this.store.applications().filter((a) => a.connectionId === id))
      this.store.setCheck(a.id, 'connecting', this.state.message);
    try {
      await this.browser.openLogin(c);
    } catch {
      this.state.message = 'Edge 窗口打开失败，请重试或跳过。';
    }
  }
  async check() {
    if (this.stopped || this.checking || !this.state.active || !this.state.currentId) return;
    this.checking = true;
    const id = this.state.currentId;
    const epoch = this.epoch;
    try {
      const c = this.store.connection(id);
      const result = await this.browser.checkLogin(c);
      if (this.stopped || !this.state.active || this.state.currentId !== id || this.epoch !== epoch)
        return;
      if (result.kind === 'success') {
        const imported = this.store.importApplications(
          c,
          result.applications,
          result.applicationUrl,
        );
        for (const a of this.store
          .applications()
          .filter((a) => a.connectionId === c.id && !a.externalId))
          if (!this.store.markLoggedInWithoutApplication(a.id, result.applications))
            this.store.setCheck(a.id, 'unmatched', '已读到官网投递，请选择对应的岗位。');
        const waiting = this.store
          .applications()
          .filter((a) => a.connectionId === c.id && !a.externalId && a.checkState === 'unmatched');
        const none = imported.importedIds.length === 0 && waiting.length === 0;
        this.state.results.push({
          company: c.name,
          state: none ? 'empty' : 'imported',
          imported: imported.importedIds.length,
          message: none
            ? NOT_APPLIED_MESSAGE
            : waiting.length
              ? `读到 ${result.applications.length} 条官网记录，还有 ${waiting.length} 个入口需要选择岗位。`
              : `读到 ${result.applications.length} 条官网记录，新增 ${imported.importedIds.length} 条；实习、社招及明确的其他届别已排除。`,
        });
        await this.next();
      } else this.state.message = result.message;
    } catch (error) {
      this.state.message = error instanceof Error ? error.message : '读取失败，请重试或跳过。';
    } finally {
      this.checking = false;
    }
  }
  async skip() {
    if (this.checking) throw new Error('正在检查连接，请稍后再跳过。');
    if (this.state.currentId) {
      const c = this.store.connection(this.state.currentId);
      this.state.results.push({
        company: c.name,
        state: 'skipped',
        imported: 0,
        message: '本次跳过，已有记录保留。',
      });
      await this.browser.finishLogin?.(c.id);
      for (const a of this.store
        .applications()
        .filter((a) => a.connectionId === c.id && a.checkState === 'connecting'))
        this.store.setCheck(
          a.id,
          c.verifiedAt && a.rawStatus ? 'ok' : 'unknown',
          c.verifiedAt && a.rawStatus
            ? ''
            : '本次未读取。已登录的话，下次刷新会直接用当前 Edge 会话。',
        );
    }
    await this.next();
    return this.state;
  }
  async cancel() {
    const id = this.state.currentId;
    this.epoch = (this.epoch ?? 0) + 1;
    this.state.active = false;
    this.state.currentId = null;
    this.state.queue = [];
    this.state.message = '连接流程已暂停，可稍后继续。';
    if (id) {
      for (const a of this.store
        .applications()
        .filter((a) => a.connectionId === id && a.checkState === 'connecting'))
        this.store.setCheck(a.id, 'unknown', '连接流程已暂停，可稍后继续。');
      await this.browser.finishLogin?.(id);
    }
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
