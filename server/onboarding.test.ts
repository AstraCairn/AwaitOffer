import { afterEach, describe, expect, it } from 'vitest';
import { NOT_APPLIED_MESSAGE } from '../shared/model.js';
import { Onboarding } from './onboarding.js';
import { temporaryStore, FakeBrowser, autoInput } from './test-utils.js';
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
function setup() {
  const f = temporaryStore(),
    browser = new FakeBrowser();
  const onboarding = new Onboarding(f.store, browser);
  const first = f.store.create(autoInput({ position: '待确认岗位' }));
  const second = f.store.create(
    autoInput({
      company: '另一公司',
      position: '待确认岗位',
      url: 'https://second.jobs.feishu.cn/campus/position/application',
    }),
  );
  cleanups.push(() => {
    onboarding.stop();
    f.store.close();
    f.remove();
  });
  return { ...f, browser, onboarding, ids: [first.connectionId!, second.connectionId!] };
}
describe('login and import wizard', () => {
  it('opens one site at a time and automatically imports and advances without a confirmation click', async () => {
    const f = setup();
    await f.onboarding.start(f.ids);
    expect(f.onboarding.state.currentId).toBe(f.ids[0]);
    await f.onboarding.check();
    expect(f.onboarding.state.currentId).toBe(f.ids[1]);
    expect(f.store.applications()[0].externalId).toBe('application-1');
    await f.onboarding.check();
    expect(f.onboarding.state.active).toBe(false);
    expect(f.onboarding.state.results.map((r) => r.imported)).toEqual([1, 1]);
    expect(f.store.applications()).toHaveLength(2);
  });
  it('waits for real login success and permits skipping without changing previous progress', async () => {
    const f = setup();
    f.browser.result = { kind: 'expired', message: '请登录' };
    await f.onboarding.start(f.ids);
    await f.onboarding.check();
    expect(f.store.connections()[0].verifiedAt).toBeNull();
    expect(f.onboarding.state.currentId).toBe(f.ids[0]);
    await f.onboarding.skip();
    expect(f.onboarding.state.currentId).toBe(f.ids[1]);
    expect(f.onboarding.state.results[0].state).toBe('skipped');
    await f.onboarding.cancel();
    expect(f.onboarding.state.active).toBe(false);
  });
  it('retains empty or excluded bookmarks with an informative status', async () => {
    const f = setup();
    f.browser.result = { kind: 'success', applications: [] };
    await f.onboarding.start([f.ids[0]]);
    await f.onboarding.check();
    expect(f.onboarding.state.results[0].state).toBe('empty');
    expect(f.onboarding.state.results[0].message).toBe(NOT_APPLIED_MESSAGE);
    expect(f.store.applications()[0].checkState).toBe('ok');
    expect(f.store.applications()[0].checkMessage).toBe(NOT_APPLIED_MESSAGE);
    expect(f.store.applications()[0].rawStatus).toBe('');
  });
  it('treats internships and other cohorts as not yet applied', async () => {
    const f = setup();
    f.browser.result = {
      kind: 'success',
      applications: [
        { id: 'intern', position: '后端', batch: '2027届实习', rawStatus: '已投递' },
        { id: 'old', position: '后端', batch: '2026届秋招', rawStatus: '已投递' },
      ],
    };
    await f.onboarding.start([f.ids[0]]);
    await f.onboarding.check();
    expect(f.onboarding.state.results[0].state).toBe('empty');
    expect(f.store.applications()).toHaveLength(2);
    expect(f.store.applications()[0].externalId).toBeNull();
    expect(f.store.applications()[0].checkState).toBe('ok');
    expect(f.store.applications()[0].checkMessage).toBe(NOT_APPLIED_MESSAGE);
  });
  it('ignores a late successful check after the user pauses', async () => {
    const f = setup();
    let finish!: (value: typeof f.browser.result) => void;
    f.browser.checkLogin = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await f.onboarding.start(f.ids);
    const checking = f.onboarding.check();
    await f.onboarding.cancel();
    finish({
      kind: 'success',
      applications: [{ id: 'late', position: '工程师', batch: '2027校招', rawStatus: '初筛' }],
    });
    await checking;
    expect(f.onboarding.state.active).toBe(false);
    expect(f.onboarding.state.currentId).toBeNull();
    expect(f.store.applications().every((a) => !a.externalId)).toBe(true);
  });
});
