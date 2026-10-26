import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';
import { RefreshService } from './refresh.js';
import { temporaryStore, FakeBrowser, autoInput } from './test-utils.js';
import type { QueryResult } from '../shared/model.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  vi.useRealTimers();
});
function setup() {
  const f = temporaryStore(),
    browser = new FakeBrowser();
  const refresh = new RefreshService(f.store, browser);
  let now = Date.parse('2026-10-15T00:00:00.000Z');
  const scheduler = new Scheduler(f.store, refresh, () => now);
  const app = f.store.create(autoInput());
  f.store.saveConnection({
    ...f.store.connection(app.connectionId!),
    verifiedAt: new Date(now).toISOString(),
  });
  cleanup.push(async () => {
    scheduler.stop();
    refresh.stop();
    await refresh.wait();
    f.store.close();
    f.remove();
  });
  return {
    ...f,
    browser,
    refresh,
    scheduler,
    app,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
describe('backend scheduling', () => {
  it('persists the 24-hour initial deadline and manual refreshes do not shift it', async () => {
    const f = setup();
    f.scheduler.ensureDue();
    const due = f.store.settings().nextRefreshAt;
    expect(Date.parse(due!) - f.now()).toBe(1440 * 60000);
    f.refresh.start();
    await f.refresh.wait();
    expect(f.store.settings().nextRefreshAt).toBe(due);
    await f.scheduler.tick();
    expect(f.browser.calls).toHaveLength(1);
  });
  it('runs only once for an overdue deadline after sleep and reschedules from completion', async () => {
    const f = setup();
    f.scheduler.ensureDue();
    f.advance(24 * 3600000);
    await Promise.all([f.scheduler.tick(), f.scheduler.tick(), f.scheduler.tick()]);
    expect(f.browser.calls).toHaveLength(1);
    expect(f.store.runs()[0].source).toBe('scheduled');
    expect(Date.parse(f.store.settings().nextRefreshAt!) - f.now()).toBe(1440 * 60000);
    await f.scheduler.tick();
    expect(f.browser.calls).toHaveLength(1);
  });
  it('does not query when disabled or when an expired connection is paused', async () => {
    const f = setup();
    f.scheduler.ensureDue();
    f.advance(1441 * 60000);
    f.store.saveSettings({ ...f.store.settings(), enabled: false });
    await f.scheduler.tick();
    expect(f.browser.calls).toHaveLength(0);
    f.store.saveSettings({ ...f.store.settings(), enabled: true });
    f.store.setCheck(f.app.id, 'expired', '请重新登录');
    f.store.saveConnection({ ...f.store.connection(f.app.connectionId!), pauseReason: 'expired' });
    await f.scheduler.tick();
    expect(f.browser.calls).toHaveLength(0);
    expect(f.store.runs()[0].outcomes[f.app.id]).toBe('skipped');
  });
  it.each(['all', 'single'] as const)(
    'deduplicates a due full refresh against active %s work',
    async (scope) => {
      const f = setup();
      f.scheduler.ensureDue();
      f.advance(1441 * 60000);
      let release!: (value: QueryResult) => void;
      let calls = 0;
      f.browser.query = () => {
        calls++;
        if (calls > 1) return Promise.resolve({ kind: 'success', applications: [] });
        return new Promise((resolve) => {
          release = resolve;
        });
      };
      f.refresh.start(scope === 'single' ? f.app.id : undefined);
      const tick = f.scheduler.tick();
      release({ kind: 'success', applications: [] });
      await tick;
      expect(calls).toBe(scope === 'single' ? 2 : 1);
      expect(f.refresh.active).toBeNull();
    },
  );
  it('honors an interval change while waiting for another task', async () => {
    const f = setup();
    f.scheduler.ensureDue();
    f.advance(1441 * 60000);
    let release!: (value: QueryResult) => void;
    f.browser.query = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    f.refresh.start(f.app.id);
    const tick = f.scheduler.tick();
    const nextRefreshAt = new Date(f.now() + 180 * 60000).toISOString();
    f.store.saveSettings({ ...f.store.settings(), intervalMinutes: 180, nextRefreshAt });
    release({ kind: 'success', applications: [] });
    await tick;
    expect(f.store.settings().nextRefreshAt).toBe(nextRefreshAt);
    expect(f.store.runs()).toHaveLength(1);
  });
});
