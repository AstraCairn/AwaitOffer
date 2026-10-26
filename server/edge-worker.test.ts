import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

let compiled = '';
beforeAll(async () => {
  compiled = (
    await build({
      entryPoints: ['extension/src/background.ts'],
      bundle: true,
      write: false,
      format: 'iife',
      target: 'chrome120',
      define: { AWAIT_OFFER_EXTENSION_VERSION: JSON.stringify('0.2.2') },
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
afterAll(() => {
  compiled = '';
});
function worker(
  options: {
    active?: boolean;
    update?: boolean;
    stall?: boolean;
    auth?: boolean;
    emptyUrl?: boolean;
  } = {},
) {
  vi.useFakeTimers();
  const origin = options.auth ? 'https://talent.baidu.com' : 'https://test.jobs.feishu.cn',
    url = origin + '/campus/position/application';
  const job = {
    id: randomUUID(),
    connectionId: randomUUID(),
    origin,
    url,
    platform: 'feishu',
    action: 'query',
    requestedAt: Date.now(),
  };
  let listener: (
    message: unknown,
    sender: unknown,
    respond: (value: unknown) => void,
  ) => void = () => {};
  let claimed = false,
    currentId = 11;
  const results: unknown[] = [];
  const send = (documentId: string, status: string, id = currentId) =>
    listener(
      {
        type: 'snapshot',
        snapshot: {
          origin,
          observedAt: Date.now(),
          result: options.auth
            ? { kind: 'expired', message: '请登录' }
            : {
                kind: 'success',
                applications: [
                  { id: 'remote-id', position: '工程师', batch: '2027校招', rawStatus: status },
                ],
              },
        },
      },
      { url, tab: { id }, documentId },
      () => {},
    );
  const chrome = {
    runtime: {
      getURL: (path: string) => 'chrome-extension://test/' + path,
      getManifest: () => ({ version: '0.2.2', host_permissions: [origin + '/*'] }),
      reload: vi.fn(),
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get: async () => ({
          token: 'local-test-token',
          queryWindow: {
            windowId: 99,
            anchorId: 10,
            slots: [11],
            manual: {},
          },
        }),
        set: vi.fn(async () => {}),
        remove: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    windows: {
      get: async () => ({ id: 99, focused: !!options.active }),
      create: vi.fn(),
      update: vi.fn(),
    },
    scripting: {
      executeScript: vi.fn(async () =>
        options.stall ? new Promise<never>(() => {}) : [{ documentId: 'old-document' }],
      ),
    },
    tabs: {
      query: async () => [{ id: 11, url, active: !!options.active }],
      get: async (id: number) => ({
        id,
        windowId: 99,
        active: id === 11,
        url:
          id === 10
            ? 'chrome-extension://test/workspace.html'
            : options.emptyUrl
              ? ''
              : url,
        status: 'complete',
      }),
      create: vi.fn(async () => {
        currentId = 22;
        return { id: 22, windowId: 99, url: 'about:blank' };
      }),
      update: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      sendMessage: vi.fn(async (id: number, message: { type: string }) => {
        if (message.type === 'prepare') return { ready: false };
        send('old-document', '旧页面状态', 11);
        setTimeout(() => send('fresh-document', '新页面状态', id), 1000);
        return null;
      }),
    },
  };
  const fakeFetch = async (input: string, init?: RequestInit) => {
    const route = new URL(input).pathname;
    if (route === '/extension/jobs') {
      const jobs = options.update || claimed ? [] : [job];
      claimed = true;
      return new Response(JSON.stringify(jobs), {
        headers: {
          'X-AwaitOffer-Version': options.update || (options.stall && claimed) ? '0.2.3' : '0.2.2',
        },
      });
    }
    if (route.endsWith('/result')) results.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  };
  class Socket {
    readyState = 0;
    close() {}
    send() {}
  }
  runInNewContext(
    compiled,
    {
      chrome,
      fetch: fakeFetch,
      WebSocket: Socket,
      URL,
      Response,
      TextEncoder,
      TextDecoder,
      AbortSignal,
      Date,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  return { chrome, results };
}
describe('bundled Edge worker', () => {
  it('treats a completed tab with an unreadable URL as an expired login', async () => {
    const f = worker({ emptyUrl: true });
    await vi.advanceTimersByTimeAsync(1600);
    expect(f.results).toHaveLength(1);
    expect((f.results[0] as any).result.kind).toBe('expired');
    expect((f.results[0] as any).result.message).toContain('登录站点');
  });
  it('reports a login page even when campus-page preparation cannot run, and shows an extension badge', async () => {
    const f = worker({ auth: true });
    await vi.advanceTimersByTimeAsync(1600);
    expect(f.results).toHaveLength(1);
    expect((f.results[0] as any).result.kind).toBe('expired');
    expect(f.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
  });
  it('releases a stalled browser call within the total deadline and allows an idle update afterward', async () => {
    const f = worker({ stall: true });
    await vi.advanceTimersByTimeAsync(28500);
    expect(f.results).toHaveLength(1);
    expect((f.results[0] as any).result.kind).toBe('error');
    expect((f.results[0] as any).result.message).toContain('26 秒');
    expect(f.chrome.tabs.reload).not.toHaveBeenCalled();
    expect(f.chrome.runtime.reload).toHaveBeenCalledOnce();
  });
  it('ignores a freshly emitted result from the document being reloaded, then accepts the new document', async () => {
    const f = worker();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.chrome.tabs.reload).toHaveBeenCalledOnce();
    expect(f.results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.results).toHaveLength(1);
    expect((f.results[0] as any).result.applications[0].rawStatus).toBe('新页面状态');
  });
  it('preserves an active user tab and opens a background tab sharing its browser login', async () => {
    const f = worker({ active: true });
    await vi.advanceTimersByTimeAsync(1600);
    expect(f.chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(f.chrome.tabs.reload).not.toHaveBeenCalled();
    expect(f.chrome.tabs.update).toHaveBeenCalledWith(22, { url: expect.any(String) });
    expect(f.chrome.tabs.update).not.toHaveBeenCalledWith(11, expect.anything());
    expect(f.results).toHaveLength(1);
  });
  it('loads a local update only while idle and preserves the request to refresh after updating', async () => {
    const f = worker({ update: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.chrome.storage.local.set).toHaveBeenCalledWith({ refreshAfterUpdate: true });
    expect(f.chrome.runtime.reload).toHaveBeenCalledOnce();
    expect(f.results).toHaveLength(0);
  });
});
