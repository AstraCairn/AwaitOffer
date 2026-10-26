import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryTabs } from '../extension/src/query-tabs';

afterEach(() => vi.unstubAllGlobals());
const boundary = <T>(action: () => Promise<T>) => action();
function setup() {
  let nextId = 20;
  const tabs = new Map<number, any>([
    [1, { id: 1, windowId: 1, url: 'https://example.com/', active: true }],
  ]);
  const windows = new Map<number, any>([[1, { id: 1, focused: true }]]);
  let storage: Record<string, unknown> = {};
  const chrome = {
    runtime: { getURL: (path: string) => 'chrome-extension://awaitoffer/' + path },
    storage: {
      local: {
        get: async () => structuredClone(storage),
        set: async (value: any) => {
          storage = { ...storage, ...structuredClone(value) };
        },
      },
    },
    windows: {
      create: vi.fn(async (props: any) => {
        const id = ++nextId,
          anchor = { id: ++nextId, windowId: id, url: props.url, active: true };
        tabs.set(anchor.id, anchor);
        const window = {
          id,
          focused: props.focused ?? false,
          state: props.state ?? 'normal',
          tabs: [anchor],
        };
        windows.set(id, window);
        return window;
      }),
      get: async (id: number) => {
        if (!windows.has(id)) throw new Error('gone');
        return windows.get(id);
      },
      update: vi.fn(async (id: number, props: any) => Object.assign(windows.get(id), props)),
    },
    tabs: {
      get: async (id: number) => {
        if (!tabs.has(id)) throw new Error('gone');
        return { ...tabs.get(id) };
      },
      create: vi.fn(async (props: any) => {
        const tab = { ...props, id: ++nextId };
        tabs.set(tab.id, tab);
        return { ...tab };
      }),
      update: vi.fn(async (id: number, props: any) => Object.assign(tabs.get(id), props)),
    },
  };
  vi.stubGlobal('chrome', chrome);
  return { chrome, tabs, windows, pool: createQueryTabs() };
}
describe('dedicated query window', () => {
  it('bounds a multi-company refresh to three reusable tabs in one unfocused window', async () => {
    const f = setup();
    const reserved = await Promise.all([
      f.pool.reserve(boundary),
      f.pool.reserve(boundary),
      f.pool.reserve(boundary),
    ]);
    expect(new Set(reserved.map((tab) => tab.id)).size).toBe(3);
    const waiting = f.pool.reserve(boundary);
    await new Promise((resolve) => setTimeout(resolve, 50));
    f.pool.release(reserved[0].id!);
    await expect(waiting).resolves.toMatchObject({ id: reserved[0].id });
    for (let i = 0; i < 18; i++) {
      f.pool.release(reserved[0].id!);
      expect((await f.pool.reserve(boundary)).id).toBe(reserved[0].id);
    }
    expect(f.chrome.windows.create).toHaveBeenCalledOnce();
    expect(f.chrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'normal', focused: false }),
    );
    expect(f.chrome.tabs.create).toHaveBeenCalledTimes(3);
    expect(f.tabs.get(1).url).toBe('https://example.com/');
  });
  it('reuses its verified window after a worker reload, and rejects a stale window identity', async () => {
    const f = setup();
    const first = await f.pool.reserve(boundary);
    f.pool.release(first.id!);
    expect((await createQueryTabs().reserve(boundary)).id).toBe(first.id);
    expect(f.chrome.windows.create).toHaveBeenCalledOnce();
    const created = [...f.windows.values()].find((window) => window.id !== 1);
    const anchor = [...f.tabs.values()].find(
      (tab) => tab.windowId === created.id && tab.url.includes('workspace.html'),
    );
    anchor.url = 'https://example.com/';
    await createQueryTabs().reserve(boundary);
    expect(f.chrome.windows.create).toHaveBeenCalledTimes(2);
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
  });
  it('focuses the existing verification page on demand and never reuses it for another company', async () => {
    const f = setup(),
      url = 'https://test.jobs.feishu.cn/application';
    const tab = await f.pool.reserve(boundary);
    Object.assign(f.tabs.get(tab.id!), { url });
    f.pool.release(tab.id!);
    const opened = await f.pool.open(new URL(url).origin, url, boundary);
    expect(opened.id).toBe(tab.id);
    expect(f.chrome.tabs.update).toHaveBeenCalledWith(tab.id, { active: true });
    const next = await f.pool.reserve(boundary);
    expect(next.id).not.toBe(tab.id);
    expect((await f.pool.open(new URL(url).origin, url, boundary)).id).toBe(tab.id);
    expect(f.chrome.tabs.update.mock.calls.every(([, props]) => !('url' in props))).toBe(true);
  });
  it('leaves a foreground or moved query tab under the user’s control', async () => {
    const f = setup();
    const first = await f.pool.reserve(boundary);
    f.pool.release(first.id!);
    f.windows.get(first.windowId).focused = true;
    f.tabs.get(first.id!).active = true;
    const second = await f.pool.reserve(boundary);
    expect(second.id).not.toBe(first.id);
    f.pool.release(second.id!);
    f.tabs.get(second.id!).windowId = 1;
    expect((await f.pool.reserve(boundary)).id).not.toBe(second.id);
    expect(f.chrome.tabs.update).not.toHaveBeenCalled();
  });
});
