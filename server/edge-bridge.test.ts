import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEdgeBridge } from './edge-bridge.js';
import { edgeResultSchema } from '../shared/edge-protocol.js';
import { temporaryStore, autoInput } from './test-utils.js';
import { Store } from './store.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const f = temporaryStore();
  const record = f.store.create(autoInput({ position: '待确认岗位' }));
  const bridge = createEdgeBridge(f.store, process.cwd(), 'test-extension');
  await bridge.app.ready();
  cleanups.push(async () => {
    await bridge.app.close();
    f.remove();
  });
  const headers = { host: '127.0.0.1:3182', origin: 'chrome-extension://test-extension' };
  const pair = await bridge.app.inject({
    method: 'POST',
    url: '/extension/pair',
    headers,
    payload: { extensionId: 'test-extension', code: bridge.setup().pairCode },
  });
  expect(pair.statusCode).toBe(200);
  const authorization = `Bearer ${pair.json().token}`;
  const internal = JSON.parse(readFileSync(join(f.path, 'edge-bridge.json'), 'utf8')).internalToken;
  return { ...f, ...bridge, record, headers: { ...headers, authorization }, internal };
}
const success = {
  kind: 'success',
  applications: [{ id: 'remote-1', position: '工程师', batch: '2027届秋招', rawStatus: '初筛' }],
};
describe('daily Edge local bridge', () => {
  it('keeps a site delivery time on a query result', () => {
    expect(
      edgeResultSchema.parse({
        kind: 'success',
        applications: [{ ...success.applications[0], appliedAt: '2026-10-12 09:30' }],
      }).applications[0],
    ).toMatchObject({ appliedAt: '2026-10-12 09:30' });
  });

  it('reports the loaded extension version and limits diagnostics to progress fields without query strings', async () => {
    const f = await setup();
    await f.app.inject({ url: '/extension/jobs?version=0.2.1', headers: f.headers });
    expect(f.setup().extensionVersion).toBe('0.2.1');
    const payload = {
      origin: new URL(f.record.url).origin,
      observedAt: Date.now(),
      readyState: 'complete',
      visibility: 'hidden',
      mainVisible: [],
      isolatedVisible: [],
      candidates: success.applications,
      routes: ['/api/application/list'],
      campusTabFound: false,
      cards: 1,
    };
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/diagnostic',
          headers: f.headers,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/diagnostic',
          headers: f.headers,
          payload: { ...payload, cookie: 'forbidden' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/diagnostic',
          headers: f.headers,
          payload: { ...payload, routes: ['/api/application?token=forbidden'] },
        })
      ).statusCode,
    ).toBe(400);
    const diagnostic = readFileSync(
      join(f.path, 'diagnostics', `edge-${f.record.connectionId}.json`),
      'utf8',
    );
    expect(diagnostic).not.toContain('forbidden');
    expect(diagnostic).not.toContain(f.internal);
  });
  it('skips one extension-update refresh when the one-shot file is present', async () => {
    const f = await setup();
    const skip = join(f.path, 'skip-next-full-refresh');
    writeFileSync(skip, '');
    const response = await f.app.inject({
      method: 'POST',
      url: '/extension/start-refresh',
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ skipped: true });
    expect(existsSync(skip)).toBe(false);
  });
  it('requires the paired token and rejects foreign origins before any write', async () => {
    const f = await setup();
    expect(
      (await f.app.inject({ url: '/extension/jobs', headers: { host: '127.0.0.1:3182' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/use-edge',
          headers: { ...f.headers, origin: 'https://unrelated.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          url: '/internal/snapshot/' + f.record.connectionId,
          headers: { ...f.headers },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await f.app.inject({ url: '/api/setup', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(403);
  });
  it('deduplicates connection jobs and leaves Diff to the refresh transaction', async () => {
    const f = await setup();
    const first = f.enqueue(f.record.connectionId!, 'query');
    const second = f.enqueue(f.record.connectionId!, 'query');
    expect(first).toBe(second);
    const jobs = (await f.app.inject({ url: '/extension/jobs', headers: f.headers })).json();
    expect(jobs).toHaveLength(1);
    expect(
      (await f.app.inject({ url: '/extension/jobs', headers: f.headers })).json(),
    ).toHaveLength(0);
    await f.app.inject({
      method: 'POST',
      url: '/extension/snapshot',
      headers: f.headers,
      payload: { origin: new URL(f.record.url).origin, observedAt: Date.now(), result: success },
    });
    expect(f.store.application(f.record.id).externalId).toBeNull();
    const response = await f.app.inject({
      method: 'POST',
      url: `/extension/jobs/${jobs[0].id}/result`,
      headers: f.headers,
      payload: { origin: new URL(f.record.url).origin, result: success },
    });
    expect(response.statusCode).toBe(200);
    expect(await first).toEqual(success);
    expect(f.store.history(f.record.id)).toHaveLength(0);
  });
  it('refuses mismatched result origins and expired page snapshots', async () => {
    const f = await setup();
    const pending = f.enqueue(f.record.connectionId!, 'query');
    const [job] = (await f.app.inject({ url: '/extension/jobs', headers: f.headers })).json();
    const post = (result: unknown, origin = new URL(f.record.url).origin) =>
      f.app.inject({
        method: 'POST',
        url: `/extension/jobs/${job.id}/result`,
        headers: f.headers,
        payload: { origin, result },
      });
    expect((await post(success, 'https://wrong.example')).statusCode).toBe(400);
    expect(
      (await post({ ...success, applicationUrl: 'https://wrong.example/personal' })).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/snapshot',
          headers: f.headers,
          payload: { origin: job.origin, observedAt: Date.now() - 120000, result: success },
        })
      ).statusCode,
    ).toBe(400);
    await post({ kind: 'expired', message: '需要登录' });
    expect((await pending).kind).toBe('expired');
    expect(f.store.history(f.record.id)).toHaveLength(0);
  });
  it('automatically imports a login result, rejects credential fields, and preserves backups without tokens', async () => {
    const f = await setup();
    const payload = {
      origin: new URL(f.record.url).origin,
      observedAt: Date.now(),
      result: success,
    };
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/snapshot',
          headers: f.headers,
          payload: { ...payload, result: { ...success, cookie: 'forbidden' } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/extension/snapshot',
          headers: f.headers,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(f.store.application(f.record.id).externalId).toBe('remote-1');
    expect(f.store.history(f.record.id)).toHaveLength(1);
    expect(f.store.connection(f.record.connectionId!).verifiedAt).not.toBeNull();
    const exported = JSON.stringify(f.store.exportBackup());
    expect(exported).not.toContain(f.internal);
    expect(exported).not.toContain(f.headers.authorization.slice(7));
  });
  it('moves every company including DJI onto daily Edge and does not interrupt a live run', async () => {
    const f = await setup();
    const dji = f.store.create(
      autoInput({
        company: '大疆',
        url: 'https://apply.careers.dji.com/deliver-query',
        platform: 'moka',
      }),
    );
    f.store.saveConnection({ ...f.store.connection(dji.connectionId!), transport: 'dedicated' });
    await f.app.inject({
      method: 'POST',
      url: '/api/use-edge',
      headers: { host: '127.0.0.1:3182', origin: 'http://127.0.0.1:3180' },
    });
    expect(f.store.connection(dji.connectionId!).transport).toBe('edge');
    expect(f.store.application(dji.id).checkState).toBe('unknown');
    expect(f.store.connection(f.record.connectionId!).transport).toBe('edge');
    const run = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: 'running' as const,
      applicationIds: [f.record.id],
      changedIds: [],
      outcomes: {},
    };
    f.store.saveRun(run);
    const companion = new Store(f.path, false);
    expect(companion.runs()[0].state).toBe('running');
    companion.close();
  });
});
