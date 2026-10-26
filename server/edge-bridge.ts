import Fastify from 'fastify';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import {
  edgePort,
  edgeResultSchema,
  type EdgeJob,
  type EdgeSetup,
  edgeDiagnosticSchema,
} from '../shared/edge-protocol.js';
import { sanitizeRecruitmentUrl, type QueryResult } from '../shared/model.js';
import { fieldMapSampleSchema, shapeSchema } from '../shared/field-map.js';
import { resolveFieldMap, xaiFieldMap, type FieldMapModel } from './field-map.js';
import { readLlmKey } from './llm-key.js';

type Pending = {
  job: EdgeJob;
  claimed: boolean;
  promise: Promise<QueryResult>;
  resolve: (value: QueryResult) => void;
  timer: ReturnType<typeof setTimeout>;
};
export function createEdgeBridge(
  store: Store,
  root: string,
  expectedExtensionId?: string,
  model?: FieldMapModel | null,
) {
  const key = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'))
    .key as string;
  const extensionId =
    expectedExtensionId ??
    [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
      .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
      .join('');
  const file = join(store.dataDir, 'edge-bridge.json');
  const credentialSchema = z.object({
    internalToken: z.string().min(32),
    extensionToken: z.string().min(32).nullable(),
  });
  let credentials = existsSync(file)
    ? credentialSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    : { internalToken: randomBytes(32).toString('hex'), extensionToken: null };
  writeFileSync(file, JSON.stringify(credentials), { mode: 0o600 });
  let code = randomBytes(8).toString('hex'),
    codeAt = Date.now(),
    lastSeen = 0;
  let extensionVersion: string | null = null;
  const pending = new Map<string, Pending>();
  const snapshots = new Map<string, { at: number; result: QueryResult }>();
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const extensionOrigin = `chrome-extension://${extensionId}`;
  const socketServer = new WebSocketServer({ noServer: true, handleProtocols: () => 'awaitoffer' });
  app.server.on('upgrade', (request, socket, head) => {
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((s) => s.trim());
    if (
      request.url !== '/extension/socket' ||
      request.headers.origin !== extensionOrigin ||
      !credentials.extensionToken ||
      !protocols.includes(credentials.extensionToken)
    ) {
      socket.destroy();
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      lastSeen = Date.now();
      client.on('message', () => {
        lastSeen = Date.now();
        client.send('{"type":"pong"}');
      });
      client.send('{"type":"wake"}');
    });
  });
  const wake = () => {
    for (const client of socketServer.clients)
      if (client.readyState === 1) client.send('{"type":"wake"}');
  };
  const localOrigins = new Set([
    `http://127.0.0.1:${process.env.PORT ?? 3180}`,
    `http://localhost:${process.env.PORT ?? 3180}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  app.addHook('onRequest', async (request, reply) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? ''))
      return reply.code(403).send({ message: '仅允许本机访问。' });
    const origin = request.headers.origin;
    reply.header('Access-Control-Expose-Headers', 'X-AwaitOffer-Version');
    if (origin && origin !== extensionOrigin && !localOrigins.has(origin))
      return reply.code(403).send({ message: '不接受该来源的请求。' });
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Expose-Headers', 'X-AwaitOffer-Version');
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
    if (request.url.startsWith('/internal/')) {
      if (request.headers.authorization !== `Bearer ${credentials.internalToken}`)
        return reply.code(401).send({ message: '本地服务认证失败。' });
    } else if (request.url.startsWith('/extension/') && request.url !== '/extension/pair') {
      if (
        !credentials.extensionToken ||
        request.headers.authorization !== `Bearer ${credentials.extensionToken}`
      )
        return reply.code(401).send({ message: '请先在扩展中连接本地面板。' });
      lastSeen = Date.now();
      const version = new URL(request.url, 'http://127.0.0.1').searchParams.get('version');
      if (version && /^\d+\.\d+\.\d+$/.test(version)) extensionVersion = version;
      reply.header(
        'X-AwaitOffer-Version',
        JSON.parse(
          readFileSync(
            join(
              root,
              'extension',
              existsSync(join(root, 'extension', 'build-info.json'))
                ? 'build-info.json'
                : 'manifest.json',
            ),
            'utf8',
          ),
        ).version,
      );
    }
  });
  app.setErrorHandler((error, _request, reply) =>
    reply.code(400).send({ message: error instanceof Error ? error.message : '请求格式不正确。' }),
  );
  const setup = (): EdgeSetup => {
    if (Date.now() - codeAt > 600000) {
      code = randomBytes(8).toString('hex');
      codeAt = Date.now();
    }
    return {
      extensionVersion,
      connected: Date.now() - lastSeen < 70000,
      paired: !!credentials.extensionToken,
      extensionId,
      extensionDirectory: join(root, 'extension'),
      pairCode: code,
      lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
      edgeConnections: store.connections().filter((c) => c.transport === 'edge').length,
      preservedCompanies: store
        .connections()
        .filter(
          (c) => new URL(c.url).hostname === 'apply.careers.dji.com' && c.transport !== 'edge',
        )
        .map((c) => c.name),
    };
  };
  app.get('/api/setup', async () => setup());
  app.get('/health', async () => ({
    ok: true,
    name: 'AwaitOffer Edge Bridge',
    project: createHash('sha256').update(store.dataDir.toLowerCase()).digest('hex').slice(0, 16),
  }));
  const useEdge = () => {
    let changed = 0;
    for (const c of store.connections())
      if (c.transport !== 'edge') {
        store.saveConnection({ ...c, transport: 'edge', verifiedAt: null, pauseReason: null });
        for (const application of store.applications())
          if (application.connectionId === c.id)
            store.setCheck(
              application.id,
              'unknown',
              '已改为复用日常 Edge 的登录。后台能读到进度就直接更新；读不到时点“去登录”。',
            );
        changed++;
      }
    return changed;
  };
  app.post('/api/use-edge', async () => ({ changed: useEdge(), ...setup() }));
  app.post('/extension/pair', async (request) => {
    const body = z
      .object({ code: z.string(), extensionId: z.string() })
      .strict()
      .parse(request.body);
    if (body.extensionId !== extensionId || body.code !== code || Date.now() - codeAt > 600000)
      throw new Error('连接码无效，请重新打开面板连接。');
    credentials = { ...credentials, extensionToken: randomBytes(32).toString('hex') };
    for (const client of socketServer.clients) client.close();
    writeFileSync(file, JSON.stringify(credentials), { mode: 0o600 });
    code = randomBytes(8).toString('hex');
    codeAt = Date.now();
    lastSeen = Date.now();
    useEdge();
    return { token: credentials.extensionToken };
  });
  app.get('/extension/jobs', async () => {
    const jobs = [...pending.values()].filter((p) => !p.claimed).slice(0, 3);
    jobs.forEach((p) => (p.claimed = true));
    return jobs.map((p) => p.job);
  });
  app.post('/extension/field-map', async (request) => {
    const body = z
      .object({
        origin: z.string().url(),
        shapes: z.array(shapeSchema).max(20),
        samples: z.array(fieldMapSampleSchema).max(8),
      })
      .strict()
      .parse(request.body);
    const chosen =
      model === undefined
        ? readLlmKey(store.dataDir)
          ? (prompt: string) => xaiFieldMap(store.dataDir, prompt)
          : null
        : model;
    return resolveFieldMap(store, body.origin, body.shapes, body.samples, chosen);
  });
  app.post('/extension/diagnostic', async (request) => {
    const body = edgeDiagnosticSchema.parse(request.body);
    const c = store.connections().find((c) => c.origin === body.origin && c.transport === 'edge');
    if (!c) return { ok: true, ignored: true };
    const { mkdirSync } = await import('node:fs');
    const dir = join(store.dataDir, 'diagnostics');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${body.readyState === 'worker' ? 'edge-worker' : 'edge'}-${c.id}.json`),
      JSON.stringify(body, null, 2),
    );
    return { ok: true };
  });
  app.post('/extension/start-refresh', async () => {
    // 扩展热更新会带上一次全量刷新。放一个一次性文件即可跳过，避免把未点名的公司一起打开。
    const skipRefresh = join(store.dataDir, 'skip-next-full-refresh');
    if (existsSync(skipRefresh)) {
      unlinkSync(skipRefresh);
      return { skipped: true };
    }
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3180}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error((data as { message?: string }).message ?? '本地面板暂不可用。');
    return data;
  });
  const validateResult = (origin: string, value: unknown) => {
    const result = edgeResultSchema.parse(value);
    if (result.kind === 'success' && result.applicationUrl) {
      result.applicationUrl = sanitizeRecruitmentUrl(result.applicationUrl);
      if (new URL(result.applicationUrl).origin !== origin)
        throw new Error('结果页面与目标官网不一致。');
    }
    return result;
  };
  app.post('/extension/jobs/:id/result', async (request) => {
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    const item = pending.get(id);
    if (!item) throw new Error('查询任务已结束。');
    const body = z
      .object({ origin: z.string().url(), result: edgeResultSchema })
      .strict()
      .parse(request.body);
    if (body.origin !== item.job.origin) throw new Error('结果来源不匹配。');
    const result = validateResult(body.origin, body.result);
    snapshots.set(item.job.connectionId, { at: Date.now(), result });
    clearTimeout(item.timer);
    pending.delete(id);
    item.resolve(result);
    return { ok: true };
  });
  app.post('/extension/snapshot', async (request) => {
    const body = z
      .object({ origin: z.string().url(), observedAt: z.number(), result: edgeResultSchema })
      .strict()
      .parse(request.body);
    const c = store.connections().find((c) => c.origin === body.origin && c.transport === 'edge');
    if (!c) return { ok: true, ignored: true };
    if (body.observedAt < Date.now() - 60000 || body.observedAt > Date.now() + 5000)
      throw new Error('页面快照已过期。');
    const result = validateResult(body.origin, body.result);
    snapshots.set(c.id, { at: Date.now(), result });
    // A query owns its Diff transaction; unsolicited login/page updates can establish a baseline.
    if (
      result.kind === 'success' &&
      ![...pending.values()].some((p) => p.job.connectionId === c.id && p.job.action === 'query')
    )
      store.importApplications(c, result.applications, result.applicationUrl);
    return { ok: true };
  });
  const enqueue = (connectionId: string, action: 'query' | 'open') => {
    const c = store.connection(connectionId);
    if (c.transport !== 'edge') throw new Error('此连接尚未切换为日常 Edge。');
    if (Date.now() - lastSeen > 70000)
      return Promise.resolve<QueryResult>({
        kind: 'error',
        message: '日常 Edge 扩展未连接。请保持日常 Edge 打开，并点击扩展中的“连接 AwaitOffer”。',
      });
    const previous = [...pending.values()].find((p) => p.job.connectionId === c.id);
    if (previous) return previous.promise;
    const job: EdgeJob = {
      id: randomUUID(),
      connectionId,
      url: c.url,
      origin: c.origin,
      platform: c.platform,
      action,
      requestedAt: Date.now(),
    };
    let resolve!: Pending['resolve'];
    const promise = new Promise<QueryResult>((done) => (resolve = done));
    const timer = setTimeout(() => {
      pending.delete(job.id);
      resolve({
        kind: 'error',
        message: '等待日常 Edge 查询超过 30 秒；已有状态已保留。请检查扩展和官网页面。',
      });
    }, 30000);
    pending.set(job.id, { job, claimed: false, promise, resolve, timer });
    wake();
    return promise;
  };
  app.post('/internal/query', async (request) =>
    enqueue(
      z.object({ connectionId: z.uuid() }).strict().parse(request.body).connectionId,
      'query',
    ),
  );
  app.post('/internal/open', async (request) => {
    const id = z.object({ connectionId: z.uuid() }).strict().parse(request.body).connectionId;
    if (Date.now() - lastSeen > 70000)
      return { kind: 'error', message: '请先在日常 Edge 的 AwaitOffer 扩展中连接本地面板。' };
    snapshots.delete(id);
    void enqueue(id, 'open');
    return { kind: 'success', applications: [] };
  });
  app.get('/internal/snapshot/:id', async (request) => {
    const id = z.object({ id: z.uuid() }).parse(request.params).id;
    store.connection(id);
    const value = snapshots.get(id);
    return value && Date.now() - value.at < 60000
      ? value.result
      : {
          kind: 'error',
          message: '等待日常 Edge 完成登录并打开投递记录；不会刷新你的验证码页面。',
        };
  });
  app.addHook('preClose', async () => {
    for (const c of socketServer.clients) c.terminate();
    socketServer.close();
  });
  app.addHook('onClose', async () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ kind: 'error', message: '浏览器接入服务已停止。' });
    }
    pending.clear();
    store.close();
  });
  return { app, setup, enqueue, useEdge, port: edgePort };
}
