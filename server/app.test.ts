import { describe, expect, it } from 'vitest';
import { hasUnread, NOT_APPLIED_MESSAGE } from '../shared/model.js';
import { createApp } from './app.js';
import { autoInput, FakeBrowser, input, temporaryStore } from './test-utils.js';

describe('local API integration', () => {
  async function fixture() {
    const { store, remove } = temporaryStore();
    const browser = new FakeBrowser();
    const runtime = createApp(store, browser);
    await runtime.app.ready();
    return { ...runtime, store, remove, browser };
  }
  it('supports manual CRUD, timeline, read state and backup export', async () => {
    const { app, store, remove } = await fixture();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/applications',
        payload: input(),
      });
      expect(response.statusCode).toBe(201);
      const record = response.json();
      await app.inject({
        method: 'PUT',
        url: `/api/applications/${record.id}`,
        payload: input({ rawStatus: '一面' }),
      });
      expect((await app.inject(`/api/applications/${record.id}/history`)).json()).toHaveLength(2);
      const dashboard = (await app.inject('/api/dashboard')).json();
      expect(dashboard.latestChanges[record.id].fromStatus).toBe('简历初筛');
      await app.inject({ method: 'POST', url: `/api/applications/${record.id}/read` });
      expect(store.application(record.id).lastReadChangeId).not.toBeNull();
      const exported = await app.inject('/api/backup');
      expect(exported.headers['content-disposition']).toContain('attachment');
      expect(exported.json().format).toBe('AwaitOffer');
      await app.inject({ method: 'DELETE', url: `/api/applications/${record.id}` });
      expect(store.applications()).toHaveLength(0);
    } finally {
      await app.close();
      remove();
    }
  });
  it('marks every unread application as read', async () => {
    const { app, store, remove } = await fixture();
    try {
      const first = (
        await app.inject({ method: 'POST', url: '/api/applications', payload: input() })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/api/applications/${first.id}`,
        payload: input({ rawStatus: '一面' }),
      });
      const second = (
        await app.inject({
          method: 'POST',
          url: '/api/applications',
          payload: input({ company: '另一家' }),
        })
      ).json();
      await app.inject({
        method: 'PUT',
        url: `/api/applications/${second.id}`,
        payload: input({ company: '另一家', rawStatus: '二面' }),
      });
      expect(hasUnread(store.application(first.id))).toBe(true);
      expect(hasUnread(store.application(second.id))).toBe(true);
      const response = await app.inject({ method: 'POST', url: '/api/applications/read-all' });
      expect(response.statusCode).toBe(200);
      expect(hasUnread(store.application(first.id))).toBe(false);
      expect(hasUnread(store.application(second.id))).toBe(false);
    } finally {
      await app.close();
      remove();
    }
  });
  it('rejects invalid URLs, unknown auto platforms, arbitrary fields and non-local origins', async () => {
    const { app, remove } = await fixture();
    try {
      for (const payload of [
        input({ url: 'javascript:alert(1)' }),
        input({ mode: 'auto' }),
        { ...input(), password: 'not-accepted' },
      ]) {
        expect(
          (await app.inject({ method: 'POST', url: '/api/applications', payload })).statusCode,
        ).toBe(400);
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/applications',
            payload: input(),
            headers: { origin: 'https://evil.example' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/dashboard',
            headers: { host: 'evil.example:3180' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
      remove();
    }
  });
  it('connects, explicitly binds a remote job and rejects duplicate job bindings', async () => {
    const { app, refresh, store, remove } = await fixture();
    try {
      const first = (
        await app.inject({ method: 'POST', url: '/api/applications', payload: autoInput() })
      ).json();
      await refresh.wait();
      expect(
        (await app.inject({ method: 'POST', url: `/api/applications/${first.id}/connect` }))
          .statusCode,
      ).toBe(200);
      const connected = await app.inject({
        method: 'POST',
        url: `/api/applications/${first.id}/check-connection`,
      });
      expect(connected.json().kind).toBe('success');
      const bound = await app.inject({
        method: 'POST',
        url: `/api/applications/${first.id}/bind`,
        payload: { externalId: 'application-1' },
      });
      expect(bound.json().rawStatus).toBe('初筛');
      expect(store.history(first.id)).toHaveLength(1);
      const second = (
        await app.inject({
          method: 'POST',
          url: '/api/applications',
          payload: autoInput({ position: '后端' }),
        })
      ).json();
      await refresh.wait();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/applications/${second.id}/bind`,
            payload: { externalId: 'application-1' },
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
      remove();
    }
  });
  it('records a logged-in company with no application instead of asking to reconnect', async () => {
    const { app, browser, refresh, store, remove } = await fixture();
    try {
      browser.result = { kind: 'success', applications: [] };
      const record = (
        await app.inject({
          method: 'POST',
          url: '/api/applications',
          payload: autoInput({ company: '阿里巴巴', position: '待确认岗位' }),
        })
      ).json();
      await refresh.wait();
      expect(store.application(record.id).checkState).toBe('ok');
      expect(store.application(record.id).checkMessage).toBe(NOT_APPLIED_MESSAGE);
      const again = await app.inject({
        method: 'POST',
        url: `/api/applications/${record.id}/check-connection`,
      });
      expect(again.json().kind).toBe('success');
      expect(store.application(record.id).checkState).toBe('ok');
      expect(store.application(record.id).checkMessage).toBe(NOT_APPLIED_MESSAGE);
    } finally {
      await app.close();
      remove();
    }
  });
  it('does not report an invalid or expired connection as verified', async () => {
    const { app, browser, refresh, store, remove } = await fixture();
    try {
      const record = (
        await app.inject({ method: 'POST', url: '/api/applications', payload: autoInput() })
      ).json();
      await refresh.wait();
      const previousVerification = store.connections()[0].verifiedAt;
      browser.result = { kind: 'expired', message: '请登录' };
      const response = await app.inject({
        method: 'POST',
        url: `/api/applications/${record.id}/check-connection`,
      });
      expect(response.json().kind).toBe('expired');
      expect(store.connections()[0].verifiedAt).toBe(previousVerification);
    } finally {
      await app.close();
      remove();
    }
  });
  it('refuses restore while a connection window is open and leaves data intact', async () => {
    const { app, browser, store, remove } = await fixture();
    try {
      const record = store.create(autoInput());
      const backup = store.exportBackup();
      await browser.openLogin(store.connection(record.connectionId!));
      const response = await app.inject({ method: 'POST', url: '/api/restore', payload: backup });
      expect(response.statusCode).toBe(400);
      expect(store.applications()).toHaveLength(1);
    } finally {
      await app.close();
      remove();
    }
  });
});
