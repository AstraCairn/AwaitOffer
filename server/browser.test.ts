import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserService } from './browser.js';
import { temporaryStore, autoInput } from './test-utils.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  vi.restoreAllMocks();
});

function setup() {
  const f = temporaryStore();
  const record = f.store.create(autoInput());
  const connection = f.store.connection(record.connectionId!);
  writeFileSync(join(f.path, 'edge-bridge.json'), JSON.stringify({ internalToken: 'local-test-token' }));
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ kind: 'success', applications: [] })),
    );
  const browser = new BrowserService(f.path);
  cleanup.push(async () => {
    await browser.close();
    f.store.close();
    f.remove();
  });
  return { browser, fetchMock, connection };
}

describe('daily Edge sessions', () => {
  it('queries through the local bridge and does not open a second browser', async () => {
    const f = setup();
    expect(await f.browser.query(f.connection)).toEqual({ kind: 'success', applications: [] });
    expect(f.fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3182/internal/query');
  });

  it('holds a company while its login window is open, then releases it after a successful check', async () => {
    const f = setup();
    await f.browser.openLogin(f.connection);
    expect(f.browser.isLoggingIn(f.connection.id)).toBe(true);
    expect(f.fetchMock.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:3182/internal/open');
    const calls = f.fetchMock.mock.calls.length;
    expect((await f.browser.query(f.connection)).message).toContain('请先完成登录');
    expect(f.fetchMock.mock.calls).toHaveLength(calls);
    expect((await f.browser.checkLogin(f.connection)).kind).toBe('success');
    expect(f.browser.isLoggingIn(f.connection.id)).toBe(false);
    expect(await f.browser.query(f.connection)).toEqual({ kind: 'success', applications: [] });
  });

  it('reads DJI through the same daily Edge bridge', async () => {
    const f = setup();
    const dji = {
      ...f.connection,
      origin: 'https://apply.careers.dji.com',
      url: 'https://apply.careers.dji.com/candidate/applications/deliver-query/dji',
      platform: 'moka' as const,
    };
    expect((await f.browser.query(dji)).kind).toBe('success');
    expect(f.fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3182/internal/query');
  });
});
