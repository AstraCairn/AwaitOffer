import { describe, expect, it } from 'vitest';
import { selectApplications, summary } from '../src/features/applications/selectors';
const emptyFilters = {
  filter: 'all' as const,
  query: '',
  stage: 'all',
  platform: 'all',
  progress: 'all',
};
import { FakeBrowser, input, temporaryStore } from './test-utils';
import { createApp } from './app';
import type { Dashboard } from '../shared/model';

describe('workbench summaries and filters', () => {
  it('counts actual stages and unread changes without guessing unknown progress', async () => {
    const { store, remove } = temporaryStore();
    const runtime = createApp(store, new FakeBrowser());
    try {
      const first = store.create(input({ company: '甲公司' }));
      store.applyStatus(first.id, '一面', 'manual');
      store.create(input({ company: '乙公司', rawStatus: '待定' }));
      store.create(input({ company: '丙公司', rawStatus: 'Offer 已发放' }));
      store.create(input({ company: '丁公司', rawStatus: '' }));
      const data = (await runtime.app.inject('/api/dashboard')).json<Dashboard>();
      expect(summary(data)).toMatchObject({ total: 4, active: 2, unread: 1, resolved: 1 });
      expect(selectApplications(data, { ...emptyFilters, filter: 'active' }).visible).toHaveLength(
        2,
      );
      expect(selectApplications(data, { ...emptyFilters, filter: 'unread' }).visible[0].id).toBe(
        first.id,
      );
      expect(
        selectApplications(data, { ...emptyFilters, query: '  乙  ', stage: 'pool' }).visible,
      ).toHaveLength(1);
      expect(
        selectApplications(data, { ...emptyFilters, progress: '不存在的状态' }).visible,
      ).toHaveLength(0);
    } finally {
      await runtime.app.close();
      remove();
    }
  });
});
