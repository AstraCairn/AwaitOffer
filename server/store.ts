import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applicationInputSchema,
  backupSchema,
  classifyStatus,
  detectPlatform,
  hasUnread,
  isCurrentCohortApplication,
  mokaAppliedAt,
  normalizeStatus,
  NOT_APPLIED_MESSAGE,
  sanitizeRecruitmentUrl,
  websiteUrl,
  supportsAuto,
  settingsSchema,
  type Settings,
  type IgnoredApplication,
  type RemoteApplication,
  type Application,
  type ApplicationInput,
  type Backup,
  type Connection,
  type History,
  type RefreshRun,
  type Stage,
} from '../shared/model.js';
import type { FieldPaths } from '../shared/field-map.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(
    readonly dataDir: string,
    recover = true,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'awaitoffer.sqlite'), { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version > 2) throw new Error('数据库版本高于当前程序版本，请使用新版 AwaitOffer。');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, connection_id TEXT REFERENCES connections(id), document TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        document TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_by_application ON history(application_id);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ignored (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS field_maps (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        document TEXT NOT NULL,
        UNIQUE(host, fingerprint)
      );
      PRAGMA user_version=2;
    `);
    for (const run of recover ? this.runs() : [])
      if (run.state === 'running') {
        run.state = 'interrupted';
        run.finishedAt = new Date().toISOString();
        this.saveRun(run);
      }
    for (const original of recover ? this.applications() : []) {
      let app = original;
      const connection = app.connectionId
        ? this.connections().find((item) => item.id === app.connectionId)
        : undefined;
      const stalePrompt =
        app.checkState === 'connecting' ||
        (app.checkState === 'unknown' &&
          /跳过|连接已中断|请在 .+登录|请重新连接官网/.test(app.checkMessage));
      if (stalePrompt && connection?.verifiedAt && app.rawStatus)
        app = { ...app, checkState: 'ok', checkMessage: '' };
      else if (app.checkState === 'unknown' && /跳过|可稍后重新登录/.test(app.checkMessage))
        app = {
          ...app,
          checkMessage: '本次未读取。已登录的话，下次刷新会直接用当前 Edge 会话。',
        };
      else if (app.checkState === 'connecting')
        app = {
          ...app,
          checkState: 'unknown',
          checkMessage: '连接已中断。已登录的话，下次刷新会直接读取。',
        };
      if (
        app.checkState === 'unmatched' &&
        !app.rawStatus &&
        !app.externalId &&
        connection?.verifiedAt &&
        /届别规则|没有投递记录|入口已保留|官网未返回投递记录/.test(app.checkMessage)
      )
        app = { ...app, checkState: 'ok', checkMessage: NOT_APPLIED_MESSAGE };
      const appliedAt = app.appliedAt || mokaAppliedAt(app.externalId);
      if (appliedAt && appliedAt !== app.appliedAt) app = { ...app, appliedAt };
      if (!app.stageOverride && app.rawStatus) {
        const stage = classifyStatus(app.rawStatus);
        if (stage !== app.stage) app = { ...app, stage };
      }
      if (app.stage === 'rejected' && app.rawStatus && app.checkState === 'error')
        app = { ...app, checkState: 'ok', checkMessage: '' };
      if (app !== original) this.saveApplication(app);
    }
    if (recover) {
      this.rewriteRecruitmentUrls();
      this.mergeJdDomDuplicates();
      this.markRejectedRead();
      this.convertAutoPlaceholders();
    }
  }
  private rewriteRecruitmentUrls() {
    for (const connection of this.connections()) {
      try {
        const next = sanitizeRecruitmentUrl(connection.url);
        if (next !== connection.url) this.saveConnection({ ...connection, url: next });
      } catch {
        /* 保留无法规范化的历史网址 */
      }
    }
    for (const app of this.applications()) {
      try {
        const next = sanitizeRecruitmentUrl(app.url);
        if (next !== app.url) this.saveApplication({ ...app, url: next });
      } catch {
        /* 保留无法规范化的历史网址 */
      }
    }
  }
  private reassignHistory(fromId: string, toId: string) {
    for (const item of this.history(fromId)) {
      const next = { ...item, applicationId: toId };
      this.db
        .prepare('UPDATE history SET application_id=?, document=? WHERE id=?')
        .run(toId, JSON.stringify(next), item.id);
    }
  }
  private mergeJdDomDuplicates() {
    const numeric = this.applications().filter(
      (app) => app.connectionId && app.externalId && /^\d+$/.test(app.externalId),
    );
    for (const keep of numeric) {
      const extras = this.applications().filter(
        (app) =>
          app.id !== keep.id &&
          app.connectionId === keep.connectionId &&
          app.position === keep.position &&
          app.externalId?.startsWith('jd-dom:') &&
          (!app.batch || !keep.batch || app.batch === keep.batch),
      );
      if (!extras.length) continue;
      this.transaction(() => {
        let current = this.application(keep.id);
        for (const extra of extras) {
          this.reassignHistory(extra.id, current.id);
          const newer = extra.updatedAt >= current.updatedAt;
          if (newer && extra.rawStatus) {
            current = {
              ...current,
              rawStatus: extra.rawStatus,
              stage: current.stageOverride ?? classifyStatus(extra.rawStatus),
              appliedAt: extra.appliedAt || current.appliedAt,
              stateSince: extra.stateSince || current.stateSince,
              sinceKnown: extra.sinceKnown || current.sinceKnown,
              lastChangeId: extra.lastChangeId ?? current.lastChangeId,
              lastReadChangeId: extra.lastReadChangeId ?? current.lastReadChangeId,
              checkState: extra.checkState === 'ok' ? 'ok' : current.checkState,
              checkMessage: extra.checkState === 'ok' ? extra.checkMessage : current.checkMessage,
              lastCheckedAt: extra.lastCheckedAt ?? current.lastCheckedAt,
              lastAttemptAt: extra.lastAttemptAt ?? current.lastAttemptAt,
              updatedAt: extra.updatedAt,
            };
            this.saveApplication(current);
          } else if (extra.appliedAt && !current.appliedAt) {
            current = { ...current, appliedAt: extra.appliedAt };
            this.saveApplication(current);
          }
          if (extra.connectionId && extra.externalId)
            this.ignore({
              connectionId: extra.connectionId,
              externalId: extra.externalId,
              position: extra.position,
            });
          this.db.prepare('DELETE FROM applications WHERE id=?').run(extra.id);
        }
      });
    }
  }
  private markRejectedRead() {
    for (const app of this.applications()) {
      if (
        (app.stage === 'rejected' || classifyStatus(app.rawStatus) === 'rejected') &&
        hasUnread(app)
      )
        this.markRead(app.id);
    }
  }
  private convertAutoPlaceholders() {
    for (const app of this.applications()) {
      if (app.mode !== 'manual' || app.rawStatus) continue;
      try {
        if (!supportsAuto(app.url)) continue;
        this.enableAuto(app.id);
      } catch {
        /* 转换失败时保留手动入口 */
      }
    }
  }
  private all<T>(table: string): T[] {
    return (
      this.db.prepare(`SELECT document FROM ${table} ORDER BY rowid`).all() as {
        document: string;
      }[]
    ).map((row) => JSON.parse(row.document) as T);
  }
  applications() {
    return this.all<Application>('applications');
  }
  connections() {
    return this.all<Connection>('connections');
  }
  settings(): Settings {
    return settingsSchema.parse(this.all<Settings>('settings')[0] ?? {});
  }
  saveSettings(value: Settings) {
    const settings = settingsSchema.parse(value);
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run('default', JSON.stringify(settings));
    return settings;
  }
  ignored() {
    return this.all<IgnoredApplication>('ignored');
  }
  unignore(connectionId: string, externalId: string) {
    this.db
      .prepare('DELETE FROM ignored WHERE id=?')
      .run(JSON.stringify([connectionId, externalId]));
  }
  private ignore(item: IgnoredApplication) {
    this.db
      .prepare('INSERT OR REPLACE INTO ignored VALUES (?,?)')
      .run(JSON.stringify([item.connectionId, item.externalId]), JSON.stringify(item));
  }
  runs() {
    return this.all<RefreshRun>('runs').reverse();
  }
  history(id: string) {
    return (
      this.db
        .prepare('SELECT document FROM history WHERE application_id=? ORDER BY rowid DESC')
        .all(id) as { document: string }[]
    ).map((row) => JSON.parse(row.document) as History);
  }
  application(id: string) {
    const app = this.applications().find((a) => a.id === id);
    if (!app) throw new Error('投递记录不存在');
    return app;
  }
  connection(id: string) {
    const item = this.connections().find((c) => c.id === id);
    if (!item) throw new Error('官网连接不存在');
    return item;
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  saveApplication(app: Application) {
    this.db
      .prepare(
        'INSERT INTO applications VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,document=excluded.document',
      )
      .run(app.id, app.connectionId, JSON.stringify(app));
  }
  saveConnection(connection: Connection) {
    this.db
      .prepare(
        'INSERT INTO connections VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(connection.id, JSON.stringify(connection));
  }
  saveRun(run: RefreshRun) {
    this.db
      .prepare(
        'INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(run.id, JSON.stringify(run));
  }
  private addHistory(item: History) {
    this.db
      .prepare('INSERT INTO history VALUES (?, ?, ?)')
      .run(item.id, item.applicationId, JSON.stringify(item));
  }
  create(input: ApplicationInput, now = new Date().toISOString(), wrap = true): Application {
    const parsed = applicationInputSchema.parse(input);
    if (parsed.mode === 'auto') {
      parsed.platform = detectPlatform(parsed.url);
      if (!supportsAuto(parsed.url)) throw new Error('此官网暂未适配自动查询，请使用手动模式。');
    }
    const work = () => {
      let connectionId: string | null = null;
      if (parsed.mode === 'auto') {
        const origin = new URL(parsed.url).origin;
        let connection = this.connections().find(
          (c) => c.origin === origin && c.platform === parsed.platform,
        );
        if (!connection) {
          connection = {
            id: randomUUID(),
            origin,
            url: parsed.url,
            platform: parsed.platform as Connection['platform'],
            adapterId: new URL(parsed.url).hostname,
            transport: 'edge',
            pauseReason: null,
            name: parsed.company,
            createdAt: now,
            verifiedAt: null,
          };
          this.saveConnection(connection);
        }
        connectionId = connection.id;
      }
      const rawStatus = parsed.mode === 'manual' ? normalizeStatus(parsed.rawStatus) : '';
      const app: Application = {
        ...parsed,
        rawStatus,
        id: randomUUID(),
        connectionId,
        externalId: null,
        stage: parsed.stageOverride ?? classifyStatus(rawStatus),
        stateSince: rawStatus ? now : null,
        sinceKnown: false,
        createdAt: now,
        updatedAt: now,
        lastAttemptAt: null,
        lastCheckedAt: null,
        checkState: 'unknown',
        checkMessage: '',
        lastChangeId: null,
        lastReadChangeId: null,
      };
      this.saveApplication(app);
      if (rawStatus)
        this.addHistory({
          id: randomUUID(),
          applicationId: app.id,
          fromStatus: null,
          toStatus: rawStatus,
          at: now,
          source: 'initial',
        });
      return app;
    };
    return wrap ? this.transaction(work) : work();
  }
  edit(id: string, input: ApplicationInput): Application {
    const parsed = applicationInputSchema.parse(input);
    const app = this.application(id);
    if (parsed.mode !== app.mode || (app.mode === 'auto' && parsed.url !== app.url))
      throw new Error('自动记录的官网或模式不能直接更换，请为新的官网新增投递。');
    const now = new Date().toISOString();
    this.transaction(() => {
      this.saveApplication({
        ...app,
        company: parsed.company,
        position: parsed.position,
        batch: parsed.batch,
        url: parsed.url,
        platform: app.mode === 'manual' ? parsed.platform : app.platform,
        stageOverride: parsed.stageOverride,
        stage: parsed.stageOverride ?? classifyStatus(app.rawStatus),
        appliedAt: parsed.appliedAt,
        updatedAt: now,
      });
      if (app.mode === 'manual' && normalizeStatus(parsed.rawStatus))
        this.applyStatus(id, parsed.rawStatus, 'manual', now, false);
      else if (app.mode === 'manual' && app.rawStatus && !normalizeStatus(parsed.rawStatus))
        throw new Error('已有进度不能清空，请填写新的状态。');
    });
    return this.application(id);
  }
  applyStatus(
    id: string,
    status: string,
    source: 'auto' | 'manual',
    now = new Date().toISOString(),
    wrap = true,
  ): boolean {
    const work = () => {
      const app = this.application(id);
      const rawStatus = normalizeStatus(status);
      if (!rawStatus || rawStatus.length > 200)
        throw new Error('官网未返回有效状态，保留已有进度。');
      const changed = !!app.rawStatus && normalizeStatus(app.rawStatus) !== rawStatus;
      const initial = !app.rawStatus;
      if (initial || changed) {
        const history: History = {
          id: randomUUID(),
          applicationId: id,
          fromStatus: app.rawStatus || null,
          toStatus: rawStatus,
          at: now,
          source: initial ? 'initial' : source,
        };
        this.addHistory(history);
        app.stateSince = now;
        app.sinceKnown = changed;
        if (changed) app.lastChangeId = history.id;
      }
      app.rawStatus = rawStatus;
      app.stage = app.stageOverride ?? classifyStatus(rawStatus);
      if (changed && classifyStatus(rawStatus) === 'rejected' && app.lastChangeId)
        app.lastReadChangeId = app.lastChangeId;
      app.updatedAt = now;
      if (source === 'auto') {
        app.lastCheckedAt = now;
        app.lastAttemptAt = now;
        app.checkState = 'ok';
        app.checkMessage = '';
      }
      this.saveApplication(app);
      return changed;
    };
    return wrap ? this.transaction(work) : work();
  }
  setCheck(id: string, state: Application['checkState'], message: string) {
    const app = this.application(id);
    this.saveApplication({
      ...app,
      checkState: state,
      checkMessage: message.slice(0, 1000),
      lastAttemptAt: new Date().toISOString(),
    });
  }
  markRead(id: string) {
    const app = this.application(id);
    this.saveApplication({ ...app, lastReadChangeId: app.lastChangeId });
  }
  markAllRead() {
    this.transaction(() => {
      for (const app of this.applications()) {
        if (app.lastChangeId && app.lastChangeId !== app.lastReadChangeId)
          this.saveApplication({ ...app, lastReadChangeId: app.lastChangeId });
      }
    });
  }
  remove(id: string) {
    const record = this.application(id);
    this.transaction(() => {
      if (record.connectionId && record.externalId)
        this.ignore({
          connectionId: record.connectionId,
          externalId: record.externalId,
          position: record.position,
        });
      this.db.prepare('DELETE FROM applications WHERE id=?').run(id);
    });
  }
  enableAuto(id: string) {
    const record = this.application(id);
    if (record.mode === 'auto') return record;
    if (record.rawStatus)
      throw new Error('已有手动状态的记录请保留，自动模式请新增投递，避免混淆历史。');
    return this.transaction(() => {
      const replacement = this.create(
        {
          company: record.company,
          position: record.position,
          batch: record.batch,
          url: record.url,
          mode: 'auto',
          platform: record.platform,
          rawStatus: '',
          appliedAt: record.appliedAt,
          stageOverride: record.stageOverride,
        },
        record.createdAt,
        false,
      );
      const converted = { ...replacement, id: record.id };
      this.saveApplication(converted);
      this.db.prepare('DELETE FROM applications WHERE id=?').run(replacement.id);
      return converted;
    });
  }
  private remoteCounts(items: RemoteApplication[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    return counts;
  }
  private remoteIsWellFormed(item: RemoteApplication, counts: Map<string, number>) {
    return !!(
      item.id &&
      item.id.length <= 512 &&
      item.position &&
      item.position.length <= 200 &&
      item.batch.length <= 100 &&
      item.rawStatus.length <= 200 &&
      counts.get(item.id) === 1
    );
  }
  /** A remote this import would keep for the current cohort, including one already linked. */
  hasCurrentCohortApplication(connectionId: string, items: RemoteApplication[]) {
    const counts = this.remoteCounts(items);
    const ignored = new Set(
      this.ignored()
        .filter((item) => item.connectionId === connectionId)
        .map((item) => item.externalId),
    );
    return items.some(
      (item) =>
        this.remoteIsWellFormed(item, counts) &&
        isCurrentCohortApplication(item, this.settings().cohort) &&
        !ignored.has(item.id),
    );
  }
  /**
   * A verified read left this placeholder with nothing to attach.
   * An eligible remote that was not bound stays unmatched.
   */
  markLoggedInWithoutApplication(id: string, items: RemoteApplication[]) {
    const app = this.application(id);
    if (app.externalId || app.rawStatus || !app.connectionId) return false;
    if (this.hasCurrentCohortApplication(app.connectionId, items)) return false;
    this.setCheck(id, 'ok', NOT_APPLIED_MESSAGE);
    return true;
  }
  importApplications(connection: Connection, items: RemoteApplication[], applicationUrl?: string) {
    const nextUrl = applicationUrl ? websiteUrl.parse(applicationUrl) : connection.url;
    if (new URL(nextUrl).origin !== connection.origin)
      throw new Error('投递页面与原官网连接不一致。');
    const importedIds: string[] = [];
    const changedIds: string[] = [];
    this.transaction(() => {
      const now = new Date().toISOString();
      this.saveConnection({
        ...this.connection(connection.id),
        url: nextUrl,
        verifiedAt: now,
        pauseReason: null,
      });
      const counts = this.remoteCounts(items);
      for (const item of items) {
        if (!this.remoteIsWellFormed(item, counts)) continue;
        let record = this.applications().find(
          (a) => a.connectionId === connection.id && a.externalId === item.id,
        );
        if (!record) {
          if (
            !isCurrentCohortApplication(item, this.settings().cohort) ||
            this.ignored().some((i) => i.connectionId === connection.id && i.externalId === item.id)
          )
            continue;
          const placeholders = this.applications().filter(
            (a) =>
              a.url === connection.url &&
              a.company === connection.name &&
              !a.rawStatus &&
              !a.externalId &&
              !this.history(a.id).length &&
              (a.position === '待确认岗位' ||
                (a.mode === 'auto' &&
                  a.position === item.position &&
                  a.batch === item.batch &&
                  a.updatedAt === a.createdAt)),
          );
          const placeholder =
            placeholders.length === 1
              ? placeholders[0]
              : placeholders.find((a) => a.position === '待确认岗位');
          record =
            placeholder ??
            this.create(
              {
                company: connection.name,
                position: item.position,
                batch: item.batch || '官网未提供届别/批次',
                url: connection.url,
                mode: 'auto',
                platform: connection.platform,
                rawStatus: '',
                appliedAt: item.appliedAt ?? null,
                stageOverride: null,
              },
              now,
              false,
            );
          record = {
            ...record,
            mode: 'auto',
            platform: connection.platform,
            connectionId: connection.id,
            externalId: item.id,
            position: item.position,
            batch: item.batch || '官网未提供届别/批次',
          };
          this.saveApplication(record);
          importedIds.push(record.id);
        }
        if (record.batch === '官网未提供届别/批次' && item.batch)
          this.saveApplication({ ...this.application(record.id), batch: item.batch });
        if (item.appliedAt && this.application(record.id).appliedAt !== item.appliedAt)
          this.saveApplication({ ...this.application(record.id), appliedAt: item.appliedAt });
        if (item.rawStatus) {
          if (this.applyStatus(record.id, item.rawStatus, 'auto', now, false))
            changedIds.push(record.id);
        } else if (!this.application(record.id).rawStatus)
          this.setCheck(
            record.id,
            'error',
            '已读取真实岗位信息；官网未提供可识别的进度，已有状态已保留。',
          );
      }
      if (nextUrl !== connection.url)
        for (const app of this.applications().filter(
          (a) => a.connectionId === connection.id && a.url === connection.url,
        ))
          this.saveApplication({ ...app, url: nextUrl });
    });
    return { importedIds, changedIds };
  }
  exportBackup(): Backup {
    return {
      format: 'AwaitOffer',
      version: 2,
      settings: this.settings(),
      ignored: this.ignored(),
      exportedAt: new Date().toISOString(),
      applications: this.applications(),
      history: this.all<History>('history'),
      connections: this.connections(),
      runs: this.runs(),
    };
  }
  restore(input: unknown) {
    const backup = backupSchema.parse(input);
    for (const [label, items] of Object.entries({
      applications: backup.applications,
      connections: backup.connections,
      history: backup.history,
      runs: backup.runs,
    })) {
      if (new Set(items.map((i) => i.id)).size !== items.length)
        throw new Error(`备份 ${label} 存在重复 ID。`);
    }
    const apps = new Map(backup.applications.map((a) => [a.id, a]));
    const connections = new Map(backup.connections.map((c) => [c.id, c]));
    const histories = new Map(backup.history.map((h) => [h.id, h]));
    for (const connection of backup.connections) {
      if (
        new URL(connection.url).origin !== connection.origin ||
        detectPlatform(connection.url) !== connection.platform
      )
        throw new Error('备份连接配置不一致。');
    }
    for (const app of backup.applications) {
      if (app.mode === 'auto' && (!app.connectionId || !connections.has(app.connectionId)))
        throw new Error('备份中的投递缺少官网连接。');
      if (app.mode === 'manual' && app.connectionId) throw new Error('手动投递不应关联自动连接。');
      if (app.connectionId && connections.get(app.connectionId)?.origin !== new URL(app.url).origin)
        throw new Error('备份中的投递与官网连接不一致。');
      for (const id of [app.lastChangeId, app.lastReadChangeId])
        if (id && histories.get(id)?.applicationId !== app.id)
          throw new Error('备份未读历史引用无效。');
    }
    for (const item of backup.history)
      if (!apps.has(item.applicationId)) throw new Error('备份历史对应的投递不存在。');
    const recoveryDir = join(this.dataDir, 'backups');
    mkdirSync(recoveryDir, { recursive: true });
    const recoveryFile = `before-restore-${Date.now()}.json`;
    writeFileSync(join(recoveryDir, recoveryFile), JSON.stringify(this.exportBackup(), null, 2), {
      flag: 'wx',
    });
    this.transaction(() => {
      this.db.exec(
        'DELETE FROM history; DELETE FROM applications; DELETE FROM connections; DELETE FROM runs; DELETE FROM ignored; DELETE FROM settings;',
      );
      // 恢复不携带登录。连接改到日常 Edge，需用该浏览器里仍然有效的会话重新验证。
      const connectionIds = new Map(backup.connections.map((c) => [c.id, randomUUID()]));
      for (const connection of backup.connections)
        this.saveConnection({
          ...connection,
          id: connectionIds.get(connection.id)!,
          transport: 'edge',
          verifiedAt: null,
          pauseReason: 'expired',
        });
      for (const app of backup.applications)
        this.saveApplication({
          ...app,
          connectionId: app.connectionId ? connectionIds.get(app.connectionId)! : null,
          checkState: app.mode === 'auto' ? 'expired' : app.checkState,
          checkMessage:
            app.mode === 'auto' ? '备份不包含登录态，请重新连接官网。' : app.checkMessage,
        });
      for (const item of backup.history) this.addHistory(item);
      this.saveSettings({ ...settingsSchema.parse(backup.settings ?? {}), nextRefreshAt: null });
      for (const item of backup.ignored ?? []) {
        const id = connectionIds.get(item.connectionId);
        if (!id) throw new Error('备份忽略记录缺少官网连接。');
        this.ignore({ ...item, connectionId: id });
      }
      for (const run of [...backup.runs].reverse())
        this.saveRun(
          run.state === 'running'
            ? { ...run, state: 'interrupted', finishedAt: new Date().toISOString() }
            : run,
        );
    });
    return { applications: backup.applications.length, recoveryFile };
  }
  fieldMap(host: string, fingerprint: string): FieldPaths | null {
    const row = this.db
      .prepare('SELECT document FROM field_maps WHERE host=? AND fingerprint=?')
      .get(host, fingerprint) as { document: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.document).paths as FieldPaths;
  }
  saveFieldMap(map: { host: string; fingerprint: string; paths: FieldPaths; source: 'builtin' | 'llm' }) {
    this.db
      .prepare(
        `INSERT INTO field_maps (id, host, fingerprint, document) VALUES (?, ?, ?, ?)
         ON CONFLICT(host, fingerprint) DO NOTHING`,
      )
      .run(
        randomUUID(),
        map.host,
        map.fingerprint,
        JSON.stringify({ ...map, createdAt: new Date().toISOString() }),
      );
  }
  fieldMapCount() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM field_maps').get() as { n: number }).n;
  }
  close() {
    this.db.close();
  }
}
