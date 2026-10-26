import { randomUUID } from 'node:crypto';
import type { QueryResult, RefreshRun, RemoteApplication } from '../shared/model.js';
import { Store } from './store.js';
import type { BrowserQueries } from './browser.js';

export class RefreshService {
  private running: Promise<void> | null = null;
  private runId: string | null = null;
  private stopping = false;
  private pendingFull = false;
  constructor(
    readonly store: Store,
    readonly browser: BrowserQueries,
  ) {}
  get active() {
    return this.runId ? (this.store.runs().find((run) => run.id === this.runId) ?? null) : null;
  }
  start(target?: string | string[], source: 'manual' | 'scheduled' = 'manual') {
    if (this.stopping) throw new Error('服务正在停止，请重新启动后刷新。');
    const requested = typeof target === 'string' ? [target] : target;
    const active = this.active;
    if (active) {
      if (
        active.scope === 'single' &&
        (!requested || requested.some((id) => !active.applicationIds.includes(id)))
      ) {
        this.pendingFull = true;
        active.queuedFull = true;
        this.store.saveRun(active);
      }
      return active;
    }
    const apps = requested
      ? requested.map((id) => this.store.application(id))
      : this.store.applications();
    const ids = apps.filter((a) => a.mode === 'auto').map((a) => a.id);
    if (!ids.length) throw new Error('没有可自动刷新的投递，请先添加自动记录。');
    const run: RefreshRun = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: 'running',
      applicationIds: ids,
      changedIds: [],
      outcomes: {},
      source,
      scope: !requested ? 'all' : ids.length === 1 ? 'single' : 'selected',
      importedIds: [],
    };
    this.store.saveRun(run);
    this.runId = run.id;
    this.running = this.execute(run).finally(() => {
      this.runId = null;
      this.running = null;
      if (this.pendingFull && !this.stopping) {
        this.pendingFull = false;
        if (this.store.applications().some((a) => a.mode === 'auto')) this.start();
      }
    });
    return run;
  }
  private async execute(run: RefreshRun) {
    const groups = new Map<string, string[]>();
    for (const id of run.applicationIds) {
      const app = this.store.application(id);
      if (!app.connectionId) {
        this.store.setCheck(id, 'error', '缺少官网连接，请重新创建自动记录。');
        run.outcomes[id] = 'error';
        continue;
      }
      groups.set(app.connectionId, [...(groups.get(app.connectionId) ?? []), id]);
    }
    const queue = [...groups.entries()];
    const worker = async () => {
      while (queue.length && !this.stopping) {
        const [connectionId, ids] = queue.shift()!;
        try {
          const connection = this.store.connection(connectionId);
          const stillOpen = this.store
            .applications()
            .some(
              (app) =>
                app.connectionId === connectionId &&
                app.mode === 'auto' &&
                app.stage !== 'rejected',
            );
          const awaitingLogin =
            run.source === 'scheduled' &&
            !!connection.pauseReason &&
            this.store
              .applications()
              .some(
                (app) =>
                  app.connectionId === connectionId &&
                  app.mode === 'auto' &&
                  app.checkState === connection.pauseReason,
              );
          if (!stillOpen || this.browser.isLoggingIn(connectionId) || awaitingLogin) {
            for (const id of ids) run.outcomes[id] = 'skipped';
            this.store.saveRun(run);
            continue;
          }
          const result = await this.browser.query(connection);
          if (this.stopping) return;
          if (result.kind === 'expired' || result.kind === 'challenge')
            this.store.saveConnection({ ...connection, pauseReason: result.kind });
          if (result.kind === 'success') {
            if (this.store.applications().some((a) => a.connectionId === connectionId)) {
              const imported = this.store.importApplications(
                connection,
                result.applications,
                result.applicationUrl,
              );
              run.importedIds!.push(...imported.importedIds);
              run.changedIds.push(...imported.changedIds);
              const remoteIds = new Set(result.applications.map((a) => a.id));
              for (const record of this.store
                .applications()
                .filter(
                  (a) =>
                    a.connectionId === connectionId && a.externalId && remoteIds.has(a.externalId),
                )) {
                if (!run.applicationIds.includes(record.id)) run.applicationIds.push(record.id);
                if (!ids.includes(record.id)) ids.push(record.id);
              }
            }
          }
          for (const id of ids) {
            if (!this.store.applications().some((app) => app.id === id)) {
              run.outcomes[id] = 'skipped';
              continue;
            }
            this.applyResult(id, result, run);
            if (run.changedIds.includes(id)) run.outcomes[id] = 'changed';
          }
        } catch {
          if (this.stopping) return;
          for (const id of ids)
            if (this.store.applications().some((app) => app.id === id)) {
              this.store.setCheck(id, 'error', '官网查询失败，已有进度已保留。');
              run.outcomes[id] = 'error';
            }
        }
        this.store.saveRun(run);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    } finally {
      run.state = this.stopping ? 'interrupted' : 'completed';
      run.finishedAt = new Date().toISOString();
      this.store.saveRun(run);
    }
  }
  applyResult(id: string, result: QueryResult, run?: RefreshRun) {
    const app = this.store.application(id);
    if (result.kind !== 'success') {
      this.store.setCheck(id, result.kind, result.message);
      if (run) run.outcomes[id] = result.kind;
      return;
    }
    // Import establishes exact remote identifiers; subsequent checks never use fuzzy titles.
    const matches = app.externalId
      ? result.applications.filter((item) => item.id === app.externalId)
      : [];
    if (matches.length !== 1) {
      if (this.store.markLoggedInWithoutApplication(id, result.applications)) {
        if (run) run.outcomes[id] = 'ok';
        return;
      }
      this.store.setCheck(
        id,
        'unmatched',
        app.externalId
          ? '官网投递已找不到或无法唯一匹配，请重新选择投递。'
          : '尚未读取到符合当前规则且可准确关联的官网投递。',
      );
      if (run) run.outcomes[id] = 'unmatched';
      return;
    }
    const matched = matches[0];
    if (matched.appliedAt && app.appliedAt !== matched.appliedAt)
      this.store.saveApplication({ ...this.store.application(id), appliedAt: matched.appliedAt });
    if (!matched.rawStatus) {
      if (app.rawStatus) {
        this.store.setCheck(id, 'ok', '');
        if (run) run.outcomes[id] = 'ok';
        return;
      }
      this.store.setCheck(id, 'error', '官网未展示可识别的状态，已有进度已保留。');
      if (run) run.outcomes[id] = 'error';
      return;
    }
    const changed = this.store.applyStatus(id, matched.rawStatus, 'auto');
    if (result.note && !matched.appliedAt && !this.store.application(id).appliedAt)
      this.store.setCheck(id, 'ok', result.note);
    if (run) {
      run.outcomes[id] = changed ? 'changed' : 'ok';
      if (changed && !run.changedIds.includes(id)) run.changedIds.push(id);
    }
  }
  bind(id: string, remote: RemoteApplication) {
    const app = this.store.application(id);
    if (app.mode !== 'auto') throw new Error('手动记录不能绑定官网投递。');
    if (app.externalId && app.externalId !== remote.id && app.rawStatus)
      throw new Error('已有状态的记录不能切换到另一条官网投递，请为新投递新增记录。');
    this.store.transaction(() => {
      this.store.saveApplication({
        ...app,
        externalId: remote.id,
        batch: app.position === '待确认岗位' && remote.batch ? remote.batch : app.batch,
        position: app.position === '待确认岗位' || !app.position ? remote.position : app.position,
      });
      this.store.applyStatus(id, remote.rawStatus, 'auto', new Date().toISOString(), false);
    });
  }
  async wait() {
    while (this.running) await this.running;
  }
  stop() {
    this.stopping = true;
  }
}
