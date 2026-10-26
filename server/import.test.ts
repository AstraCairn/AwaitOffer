import { afterEach, describe, expect, it } from 'vitest';
import { temporaryStore, input, autoInput } from './test-utils.js';
import { Store } from './store.js';
import { hasUnread, type RemoteApplication } from '../shared/model.js';
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
function setup() {
  const f = temporaryStore();
  cleanups.push(() => {
    try {
      f.store.close();
    } catch {}
    f.remove();
  });
  const placeholder = f.store.create(
    input({
      company: '测试公司',
      url: 'https://test.jobs.feishu.cn/campus/position/application',
      position: '待确认岗位',
      rawStatus: '',
    }),
  );
  const converted = f.store.enableAuto(placeholder.id);
  return { ...f, placeholder, connection: f.store.connection(converted.connectionId!) };
}
const remote = (id: string, overrides: Partial<RemoteApplication> = {}): RemoteApplication => ({
  id,
  position: '工程师',
  batch: '2027届秋招',
  rawStatus: '初筛',
  ...overrides,
});
describe('automatic import and upgrades', () => {
  it('fills a previously unavailable batch when the website later exposes it, while keeping edited metadata', () => {
    const { store, connection, placeholder } = setup();
    store.importApplications(connection, [remote('batch-later', { batch: '' })]);
    const baseline = store.application(placeholder.id);
    store.importApplications(connection, [remote('batch-later', { batch: '2027届秋招' })]);
    expect(store.application(baseline.id).batch).toBe('2027届秋招');
    expect(store.application(baseline.id).stateSince).toBe(baseline.stateSince);
    expect(store.history(baseline.id)).toHaveLength(1);
    store.saveApplication({ ...store.application(baseline.id), batch: '我标注的批次' });
    store.importApplications(connection, [remote('batch-later', { batch: '2027届秋招' })]);
    expect(store.application(baseline.id).batch).toBe('我标注的批次');
  });
  it('stores a site delivery time and keeps it when a later read omits the clock', () => {
    const { store, connection, placeholder } = setup();
    store.importApplications(connection, [remote('dated', { appliedAt: '2026-09-22 09:30' })]);
    expect(store.application(placeholder.id).appliedAt).toBe('2026-09-22 09:30');
    store.importApplications(connection, [remote('dated')]);
    expect(store.application(placeholder.id).appliedAt).toBe('2026-09-22 09:30');
  });
  it('does not revert a concurrent browser transport switch when a query returns', () => {
    const { store, connection } = setup();
    store.saveConnection({ ...connection, transport: 'edge' });
    store.importApplications(connection, [remote('a')]);
    expect(store.connection(connection.id).transport).toBe('edge');
  });
  it('remembers a discovered application-center route while reusing the original bookmark id', () => {
    const { store, connection, placeholder } = setup();
    const applicationUrl = connection.origin + '/personal/applications';
    store.importApplications(connection, [remote('a')], applicationUrl);
    expect(store.application(placeholder.id).externalId).toBe('a');
    expect(store.application(placeholder.id).url).toBe(applicationUrl);
    expect(store.connection(connection.id).url).toBe(applicationUrl);
    expect(() =>
      store.importApplications(connection, [remote('b')], 'https://elsewhere.example/apply'),
    ).toThrow('不一致');
    expect(store.applications()).toHaveLength(1);
  });
  it('reuses a blank bookmark, imports multiple jobs, deduplicates and keeps initial histories unread-free', () => {
    const { store, connection, placeholder } = setup();
    const first = store.importApplications(connection, [remote('a'), remote('b')]);
    expect(first.importedIds).toHaveLength(2);
    expect(store.application(placeholder.id).externalId).toBe('a');
    expect(
      store.applications().every((a) => store.history(a.id).length === 1 && !hasUnread(a)),
    ).toBe(true);
    expect(store.importApplications(connection, [remote('a'), remote('b')]).importedIds).toEqual(
      [],
    );
    expect(store.applications()).toHaveLength(2);
  });
  it('excludes explicit internships, social jobs and other cohorts but imports unknown batches and ended current jobs', () => {
    const { store, connection } = setup();
    store.importApplications(connection, [
      remote('intern', { batch: '2027届暑期实习' }),
      remote('social', { batch: '社会招聘' }),
      remote('old', { batch: '26届秋招' }),
      remote('known'),
      remote('unknown', { batch: '' }),
      remote('ended', { rawStatus: '流程终止' }),
    ]);
    expect(store.applications().map((a) => a.externalId)).toEqual(['known', 'unknown', 'ended']);
    expect(store.applications()[1].batch).toBe('官网未提供届别/批次');
    expect(store.applications()[2].stage).toBe('rejected');
  });
  it('does not resurrect deleted remote jobs and allows undoing that exclusion', () => {
    const { store, connection } = setup();
    const id = store.importApplications(connection, [remote('a')]).importedIds[0];
    store.remove(id);
    expect(store.ignored()).toHaveLength(1);
    store.importApplications(connection, [remote('a')]);
    expect(store.applications()).toHaveLength(0);
    store.unignore(connection.id, 'a');
    expect(store.importApplications(connection, [remote('a')]).importedIds).toHaveLength(1);
  });
  it('preserves metadata edits, stage overrides, unread state and status timing across automatic imports', () => {
    const { store, connection } = setup();
    const id = store.importApplications(connection, [remote('a')]).importedIds[0];
    const app = store.application(id);
    store.edit(id, {
      ...input(),
      company: '我的简称',
      position: '我的备注',
      url: app.url,
      mode: 'auto',
      platform: 'feishu',
      stageOverride: 'pool',
    });
    const before = store.application(id).stateSince;
    store.importApplications(connection, [remote('a')]);
    expect(store.application(id)).toMatchObject({
      company: '我的简称',
      position: '我的备注',
      stage: 'pool',
      stateSince: before,
    });
    expect(
      store.importApplications(connection, [remote('a', { rawStatus: '一面' })]).changedIds,
    ).toEqual([id]);
    expect(hasUnread(store.application(id))).toBe(true);
    store.importApplications(connection, [remote('a')]);
    expect(store.history(id)).toHaveLength(3);
  });
  it('imports real metadata without inventing status and preserves prior progress on later missing statuses', () => {
    const { store, connection } = setup();
    const id = store.importApplications(connection, [remote('a', { rawStatus: '' })])
      .importedIds[0];
    expect(store.history(id)).toHaveLength(0);
    store.importApplications(connection, [remote('a')]);
    store.importApplications(connection, [remote('a', { rawStatus: '' })]);
    expect(store.application(id).rawStatus).toBe('初筛');
    expect(store.application(id).checkState).toBe('ok');
    expect(store.history(id)).toHaveLength(1);
  });
  it('rejects ambiguous duplicate ids and leaves manually edited placeholders intact', () => {
    const { store, connection, placeholder } = setup();
    store.saveApplication({ ...store.application(placeholder.id), position: '自己填写的岗位' });
    expect(
      store.importApplications(connection, [remote('a'), remote('a', { position: '另一岗位' })])
        .importedIds,
    ).toEqual([]);
    store.importApplications(connection, [remote('b')]);
    expect(store.application(placeholder.id).position).toBe('自己填写的岗位');
    expect(store.applications()).toHaveLength(2);
  });
  it('migrates version 1 without changing connection ids, retains settings and restores exclusions using fresh profiles', () => {
    const { store, connection, path } = setup();
    const id = store.importApplications(connection, [remote('a')]).importedIds[0];
    store.remove(id);
    store.saveSettings({ ...store.settings(), intervalMinutes: 180 });
    store.db.exec('PRAGMA user_version=1');
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.connection(connection.id).id).toBe(connection.id);
      expect(reopened.settings().intervalMinutes).toBe(180);
      reopened.restore(reopened.exportBackup());
      expect(reopened.ignored()[0].connectionId).not.toBe(connection.id);
      expect(reopened.ignored()[0].connectionId).toBe(reopened.connections()[0].id);
      const legacy = { ...reopened.exportBackup(), version: 1 };
      delete legacy.settings;
      delete legacy.ignored;
      reopened.restore(legacy);
      expect(reopened.settings().intervalMinutes).toBe(1440);
    } finally {
      reopened.close();
    }
  });
});
