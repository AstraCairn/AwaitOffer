import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import {
  applicationInputSchema,
  settingsSchema,
  supportsAuto,
  type RemoteApplication,
} from '../shared/model.js';
import { Store } from './store.js';
import { BrowserService, type BrowserQueries } from './browser.js';
import { RefreshService } from './refresh.js';
import {
  listBookmarkFolders,
  readEdgeBookmarks,
  readEdgeBookmarkTree,
  type BookmarkReader,
} from './bookmarks.js';
import { version } from './version.js';
import { Scheduler } from './scheduler.js';
import { Onboarding } from './onboarding.js';
import { llmConfigured, writeLlmKey } from './llm-key.js';

export function createApp(
  store: Store,
  browser: BrowserQueries = new BrowserService(store.dataDir),
  bookmarkReader: BookmarkReader = readEdgeBookmarkTree,
) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });
  const refresh = new RefreshService(store, browser);
  const scheduler = new Scheduler(store, refresh);
  const onboarding = new Onboarding(store, browser);
  app.addHook('onReady', async () => {
    scheduler.start();
  });
  // 仅将已解析的岗位/状态暂存内存；不将响应、Cookie 或 Token 返回前端。
  const candidates = new Map<string, { items: RemoteApplication[]; expiresAt: number }>();
  const uuidParams = z.object({ id: z.uuid() });
  const idFrom = (params: unknown) => uuidParams.parse(params).id;
  const connectionFor = (applicationId: string) => {
    const record = store.application(applicationId);
    if (!record.connectionId) throw new Error('手动记录没有自动连接。');
    return store.connection(record.connectionId);
  };
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return reply.code(403).send({ message: '仅允许本机访问。' });
    const origin = request.headers.origin;
    if (origin) {
      let accepted = false;
      try {
        const url = new URL(origin);
        accepted =
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname) &&
          [String(process.env.PORT ?? 3180), '5173'].includes(url.port);
      } catch {
        /* 无效 Origin */
      }
      if (!accepted) return reply.code(403).send({ message: '不接受其他网站发起的请求。' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message:
          '数据格式不正确：' +
          error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('；'),
      });
    const message = error instanceof Error ? error.message : '操作失败，请重试。';
    const statusCode = message.includes('不存在') ? 404 : 400;
    return reply.code(statusCode).send({ message });
  });
  app.get('/api/health', async () => ({ ok: true, name: 'AwaitOffer', version }));
  app.get('/api/settings', async () => store.settings());
  app.get('/api/llm', async () => ({ configured: llmConfigured(store.dataDir) }));
  app.put('/api/llm', async (request) => {
    const body = z
      .object({ apiKey: z.string().max(300) })
      .strict()
      .parse(request.body);
    writeLlmKey(store.dataDir, body.apiKey.trim());
    return { configured: llmConfigured(store.dataDir) };
  });
  app.put('/api/settings', async (request) => {
    const body = settingsSchema.omit({ nextRefreshAt: true }).parse(request.body);
    const previous = store.settings();
    const reset =
      previous.enabled !== body.enabled || previous.intervalMinutes !== body.intervalMinutes;
    return store.saveSettings({
      ...body,
      nextRefreshAt: body.enabled
        ? reset
          ? new Date(Date.now() + body.intervalMinutes * 60000).toISOString()
          : previous.nextRefreshAt
        : null,
    });
  });
  app.post('/api/ignored/restore', async (request) => {
    const body = z
      .object({ connectionId: z.uuid(), externalId: z.string().min(1).max(512) })
      .strict()
      .parse(request.body);
    store.connection(body.connectionId);
    store.unignore(body.connectionId, body.externalId);
    return { ok: true };
  });
  app.get('/api/onboarding', async () => onboarding.state);
  app.post('/api/onboarding/start', async (request) => {
    const { applicationIds } = z
      .object({ applicationIds: z.array(z.uuid()).max(100).optional() })
      .strict()
      .parse(request.body ?? {});
    const records = applicationIds
      ? applicationIds.map((id) => store.application(id))
      : store.applications().filter((a) => a.position === '待确认岗位' && !a.rawStatus);
    const ids: string[] = [];
    for (const record of records) {
      if (!supportsAuto(record.url)) continue;
      const connected = record.mode === 'auto' ? record : store.enableAuto(record.id);
      if (connected.connectionId) ids.push(connected.connectionId);
    }
    if (!ids.length) throw new Error('没有待连接的官网记录。');
    return onboarding.start(ids);
  });
  app.post('/api/onboarding/check', async () => {
    await onboarding.check();
    return onboarding.state;
  });
  app.post('/api/onboarding/skip', async () => onboarding.skip());
  app.post('/api/onboarding/cancel', async () => {
    await onboarding.cancel();
    return onboarding.state;
  });
  app.get('/api/dashboard', async () => ({
    settings: store.settings(),
    onboarding: onboarding.state,
    ignored: store.ignored(),
    applications: store.applications(),
    connections: store.connections(),
    latestChanges: Object.fromEntries(
      store.applications().flatMap((record) => {
        const change = record.lastChangeId
          ? store.history(record.id).find((h) => h.id === record.lastChangeId)
          : null;
        return change ? [[record.id, change]] : [];
      }),
    ),
    latestRun: store.runs()[0] ?? null,
    activeRun: refresh.active,
    adapterCoverage: [
      {
        platform: '飞书招聘',
        status: store.connections().some((c) => c.platform === 'feishu' && c.verifiedAt)
          ? '已在本机读取成功；其他站点需逐一验证'
          : '适配器已实现，待真实账号验证',
      },
      {
        platform: 'Moka',
        status: store.connections().some((c) => c.platform === 'moka' && c.verifiedAt)
          ? '已在本机读取成功；其他版本需逐一验证'
          : '适配器已实现，待真实站点验证',
      },
      {
        platform: '北森',
        status: store.connections().some((c) => c.platform === 'beisen' && c.verifiedAt)
          ? '已在本机读取成功；其他站点需逐一验证'
          : '适配器已实现，待真实账号验证',
      },
      {
        platform: '自建官网',
        status:
          '华为、阿里、快手、米哈游、荣耀、腾讯、联想、百度、京东、蚂蚁已提供字段解析；未验证站点保留入口。',
      },
    ],
  }));
  app.post('/api/applications', async (request, reply) => {
    const record = store.create(applicationInputSchema.parse(request.body));
    if (record.mode === 'auto')
      void refresh
        .wait()
        .then(() => {
          if (store.applications().some((a) => a.id === record.id)) refresh.start(record.id);
        })
        .catch(() => {});
    return reply.code(201).send(record);
  });
  app.put('/api/applications/:id', async (request) => {
    const id = idFrom(request.params);
    if (refresh.active?.applicationIds.includes(id))
      throw new Error('此记录正在查询，请等待查询结束后编辑。');
    return store.edit(id, applicationInputSchema.parse(request.body));
  });
  app.delete('/api/applications/:id', async (request) => {
    const id = idFrom(request.params);
    store.remove(id);
    return { ok: true };
  });
  app.get('/api/applications/:id/history', async (request) => {
    const id = idFrom(request.params);
    store.application(id);
    return store.history(id);
  });
  app.post('/api/applications/read-all', async () => {
    store.markAllRead();
    return { ok: true };
  });
  app.post('/api/applications/:id/read', async (request) => {
    store.markRead(idFrom(request.params));
    return { ok: true };
  });
  app.post('/api/refresh', async (request) => {
    const body = z
      .object({
        applicationId: z.uuid().optional(),
        applicationIds: z.array(z.uuid()).min(1).max(100).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    if (body.applicationId && body.applicationIds)
      throw new Error('请只指定一条投递，或一次指定多条。');
    return refresh.start(body.applicationIds ?? body.applicationId);
  });
  app.get('/api/runs/:id', async (request) => {
    const run = store.runs().find((item) => item.id === idFrom(request.params));
    if (!run) throw new Error('刷新任务不存在');
    return run;
  });
  app.post('/api/applications/:id/connect', async (request) => {
    const id = idFrom(request.params);
    const connection = connectionFor(id);
    if (onboarding.state.active && onboarding.state.currentId !== connection.id)
      throw new Error('已有官网等待登录，请先完成或跳过当前公司。');
    store.setCheck(id, 'connecting', '请在 Edge 窗口完成登录，进入投递记录后会自动导入。');
    try {
      await onboarding.start([connection.id]);
      return { ok: true };
    } catch {
      store.setCheck(id, 'error', 'Edge 登录窗口启动失败，请确认 Edge 已安装。');
      throw new Error('无法打开 Edge 登录窗口，请确认 Edge 已安装。');
    }
  });
  app.post('/api/applications/:id/check-connection', async (request) => {
    const id = idFrom(request.params);
    const connection = connectionFor(id);
    const result = await browser.checkLogin(connection);
    if (result.kind !== 'success') {
      if (result.kind === 'expired' || result.kind === 'challenge')
        store.saveConnection({ ...connection, pauseReason: result.kind });
      store.setCheck(id, result.kind, result.message);
      return result;
    }
    store.saveConnection({ ...connection, verifiedAt: new Date().toISOString() });
    candidates.set(connection.id, {
      items: result.applications,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    store.importApplications(connection, result.applications, result.applicationUrl);
    // 已绑定的记录也立即应用这次检查结果，保留历史并清除过期提醒。
    for (const record of store.applications().filter((a) => a.connectionId === connection.id)) {
      if (record.externalId) refresh.applyResult(record.id, result);
      else if (!store.markLoggedInWithoutApplication(record.id, result.applications))
        store.setCheck(record.id, 'unmatched', '连接成功，请选择对应的官网投递。');
    }
    return result;
  });
  app.get('/api/applications/:id/candidates', async (request) => {
    const connection = connectionFor(idFrom(request.params));
    const cached = candidates.get(connection.id);
    return cached && cached.expiresAt > Date.now() ? cached.items : [];
  });
  app.post('/api/applications/:id/bind', async (request) => {
    const id = idFrom(request.params);
    const connection = connectionFor(id);
    const body = z
      .object({ externalId: z.string().min(1).max(512) })
      .strict()
      .parse(request.body);
    const cache = candidates.get(connection.id);
    if (!cache || cache.expiresAt < Date.now())
      throw new Error('投递列表已过期，请重新连接并检查登录。');
    const matches = cache.items.filter((item) => item.id === body.externalId);
    if (matches.length !== 1) throw new Error('无法唯一匹配官网投递，请重新检查连接。');
    if (
      store
        .applications()
        .some(
          (a) =>
            a.id !== id && a.connectionId === connection.id && a.externalId === body.externalId,
        )
    )
      throw new Error('这条官网投递已经关联另一条记录，请检查是否重复新增。');
    refresh.bind(id, matches[0]);
    return store.application(id);
  });
  const folderSchema = z.string().min(1).max(1024).optional();
  app.get('/api/bookmarks/folders', async () => listBookmarkFolders(await bookmarkReader()));
  app.get('/api/bookmarks', async (request) => {
    const { folderId } = z.object({ folderId: folderSchema }).strict().parse(request.query);
    return readEdgeBookmarks(folderId, bookmarkReader);
  });
  app.post('/api/bookmarks/import', async (request) => {
    const { urls, folderId } = z
      .object({ urls: z.array(z.string().url()).min(1).max(500), folderId: folderSchema })
      .strict()
      .parse(request.body);
    const bookmarks = await readEdgeBookmarks(folderId, bookmarkReader);
    const wanted = new Set(urls);
    let imported = 0,
      skipped = 0;
    store.transaction(() => {
      for (const bookmark of bookmarks.filter((item) => wanted.has(item.url))) {
        const cleanPath = new URL(bookmark.url);
        cleanPath.search = '';
        cleanPath.hash = '';
        const existing = store
          .applications()
          .find(
            (item) =>
              item.url === bookmark.url ||
              (item.connectionId &&
                item.company === bookmark.company &&
                new URL(item.url).origin === new URL(bookmark.url).origin) ||
              (item.url === cleanPath.toString() &&
                item.company === bookmark.company &&
                item.position === '待确认岗位' &&
                !item.rawStatus),
          );
        if (existing) {
          if (existing.url !== bookmark.url)
            store.saveApplication({ ...existing, url: bookmark.url });
          skipped++;
          continue;
        }
        store.create(
          {
            company: bookmark.company,
            position: '待确认岗位',
            batch: '秋招正式批',
            url: bookmark.url,
            platform: bookmark.platform,
            mode: 'manual',
            rawStatus: '',
            appliedAt: null,
            stageOverride: null,
          },
          new Date().toISOString(),
          false,
        );
        imported++;
      }
    });
    return { imported, skipped };
  });
  app.post('/api/applications/:id/enable-auto', async (request) => {
    const id = idFrom(request.params);
    const replacement = store.enableAuto(id);
    void refresh
      .wait()
      .then(() => {
        if (store.applications().some((a) => a.id === replacement.id))
          refresh.start(replacement.id);
      })
      .catch(() => {});
    return replacement;
  });
  app.get('/api/backup', async (_request, reply) => {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    reply.header('Content-Disposition', `attachment; filename="awaitoffer-${day}.json"`);
    return store.exportBackup();
  });
  app.post('/api/restore', async (request) => {
    if (refresh.active || store.connections().some((c) => browser.isLoggingIn(c.id)))
      throw new Error('请等待刷新结束，并关闭所有连接窗口后再恢复备份。');
    const result = store.restore(request.body);
    scheduler.ensureDue();
    candidates.clear();
    return result;
  });
  app.addHook('onClose', async () => {
    scheduler.stop();
    onboarding.stop();
    refresh.stop();
    await browser.close();
    await refresh.wait();
    store.close();
  });
  return { app, refresh, browser, scheduler, onboarding };
}
