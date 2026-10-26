import { edgeBase, type EdgeJob } from '../../shared/edge-protocol';
import { type QueryResult } from '../../shared/model';
import { matchHostPattern } from '../../shared/sites';
import { createQueryTabs } from './query-tabs';
declare const AWAIT_OFFER_EXTENSION_VERSION: string;
type Boundary = <T>(action: () => Promise<T>) => Promise<T>;
const snapshots = new Map<
  number,
  { origin: string; observedAt: number; result: QueryResult; documentId?: string }
>();
const inFlight = new Set<string>();
const queryTabs = createQueryTabs();
let badgeQueue = Promise.resolve();
function updateLoginBadge(origin: string, result: QueryResult) {
  if (!['expired', 'challenge', 'success'].includes(result.kind)) return;
  badgeQueue = badgeQueue
    .then(async () => {
      const stored = await chrome.storage.local.get('loginAlerts');
      const origins = new Set<string>(Array.isArray(stored.loginAlerts) ? stored.loginAlerts : []);
      const changed = result.kind === 'success' ? origins.delete(origin) : !origins.has(origin);
      if (result.kind !== 'success') origins.add(origin);
      if (changed) await chrome.storage.local.set({ loginAlerts: [...origins] });
      await chrome.action.setBadgeBackgroundColor({ color: '#B7791F' });
      await chrome.action.setBadgeText({ text: origins.size ? String(origins.size) : '' });
      await chrome.action.setTitle({
        title: origins.size
          ? `AwaitOffer · ${origins.size} 家公司需登录或验证，请查看面板`
          : 'AwaitOffer · 日常 Edge 连接',
      });
    })
    .catch(() => {});
}
let polling = false;
let updating = false;
let socket: WebSocket | undefined;
async function connectSocket() {
  const { token } = await chrome.storage.local.get('token');
  if (typeof token !== 'string' || (socket && (socket.readyState === 0 || socket.readyState === 1)))
    return;
  socket = new WebSocket(edgeBase.replace('http:', 'ws:') + '/extension/socket', [
    'awaitoffer',
    token,
  ]);
  socket.onmessage = (e) => {
    try {
      if (JSON.parse(e.data).type === 'wake') void poll();
    } catch {}
  };
  socket.onclose = () => {
    socket = undefined;
    setTimeout(() => void connectSocket(), 5000);
  };
  socket.onerror = () => {};
}
setInterval(() => {
  if (socket?.readyState === 1) socket.send('{"type":"ping"}');
}, 20000);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.token) {
    socket?.close();
    socket = undefined;
    void connectSocket();
    void poll();
  }
});
async function request(path: string, body?: unknown) {
  const { token } = await chrome.storage.local.get('token');
  const r = await fetch(edgeBase + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.message ?? '本地服务未连接');
  const wanted = r.headers.get('X-AwaitOffer-Version');
  if (
    !updating &&
    wanted &&
    /^\d+\.\d+\.\d+$/.test(wanted) &&
    wanted !== AWAIT_OFFER_EXTENSION_VERSION &&
    path.startsWith('/extension/jobs') &&
    Array.isArray(value) &&
    !value.length &&
    !inFlight.size
  ) {
    updating = true;
    await chrome.storage.local.set({ refreshAfterUpdate: true });
    chrome.runtime.reload();
    throw new Error('扩展正在加载本地更新。');
  }
  return value;
}
const allowed = (url: string) =>
  chrome.runtime.getManifest().host_permissions?.some((pattern: string) =>
    matchHostPattern(pattern, url),
  ) ?? false;
async function inject(tabId: number, boundary: Boundary = (action) => action()) {
  await boundary(() =>
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['capture.js'],
      world: 'MAIN',
      injectImmediately: true,
    }),
  );
  await boundary(() =>
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
      world: 'ISOLATED',
      injectImmediately: true,
    }),
  );
}
async function run(job: EdgeJob) {
  if (inFlight.has(job.id)) return;
  inFlight.add(job.id);
  const began = Date.now();
  const expires = began + 26000;
  const boundary: Boundary = (action) => {
    const remaining = expires - Date.now();
    if (remaining <= 0) return Promise.reject(new Error('浏览器操作超过 26 秒，已有状态已保留。'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('浏览器操作超过 26 秒，已有状态已保留。')),
        remaining,
      );
      action().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  let trace: Record<string, unknown> = {};
  let reservedTab: number | undefined;
  const releaseSlot = () => {
    if (reservedTab === undefined) return;
    queryTabs.release(reservedTab);
    reservedTab = undefined;
  };
  try {
    if (!allowed(job.url)) throw new Error('扩展尚未获得此招聘站点的访问权限。');
    const tab =
      job.action === 'open'
        ? await queryTabs.open(job.origin, job.url, boundary)
        : await queryTabs.reserve(boundary);
    if (job.action === 'query') reservedTab = tab.id;
    let observedAfter = Date.now();
    let previousDocument: string | undefined;
    if (tab?.id) {
      if (job.action === 'open') {
        await inject(tab.id, boundary).catch(() => {});
      } else {
        if (tab.url && allowed(tab.url))
          previousDocument = (
            await boundary(() =>
              chrome.scripting.executeScript({
                target: { tabId: tab!.id! },
                func: () => 0,
                injectImmediately: true,
              }),
            ).catch(() => [])
          )[0]?.documentId;
        snapshots.delete(tab.id);
        if (tab.url === job.url) await boundary(() => chrome.tabs.reload(tab!.id!));
        else {
          const previous = new URL(tab.url || 'about:blank'),
            next = new URL(job.url);
          await boundary(() => chrome.tabs.update(tab!.id!, { url: job.url }));
          if (
            previous.origin + previous.pathname + previous.search ===
            next.origin + next.pathname + next.search
          )
            await boundary(() => chrome.tabs.reload(tab!.id!));
        }
      }
    }
    if (!tab.id) throw new Error('无法打开日常 Edge 标签页。');
    const tabId = tab.id;
    const deadline = Math.min(began + 25000, Date.now() + 24000);
    let prepared =
      job.action === 'open' ||
      !['talent.baidu.com', 'campus.jd.com'].includes(new URL(job.url).hostname);
    let result: QueryResult | undefined;
    while (Date.now() < deadline) {
      const current = await boundary(() => chrome.tabs.get(tabId));
      if (current.status === 'complete' && !current.url) {
        result = {
          kind: 'expired',
          message:
            '官网跳转到登录站点。点击“去登录”打开查询窗口，登录后进入投递记录；已有进度已保留。',
        };
        break;
      }
      if (
        current.url &&
        new URL(current.url).origin !== job.origin &&
        current.status === 'complete'
      ) {
        const redirected = new URL(current.url);
        result = /login|signin|passport|sso|auth/i.test(redirected.hostname + redirected.pathname)
          ? {
              kind: 'expired',
              message:
                '官网跳转到登录站点。点击“去登录”打开查询窗口，登录后进入投递记录；已有进度已保留。',
            }
          : {
              kind: 'error',
              message:
                '官网跳转到其他站点，尚未读取进度。请点击“检查连接”确认官网页面；已有进度已保留。',
            };
        break;
      }
      const snapshot = snapshots.get(tabId);
      trace = {
        status: current.status,
        urlReadable: !!current.url,
        snapshotSeen: !!snapshot,
        sameDocument: !!previousDocument && snapshot?.documentId === previousDocument,
        documentIdAvailable: !!snapshot?.documentId,
        elapsed: Date.now() - began,
      };
      if (!prepared && current.status === 'complete') {
        const state = await boundary(() =>
          chrome.tabs.sendMessage(tabId, { type: 'prepare' }),
        ).catch(async () => {
          await inject(tabId, boundary).catch(() => {});
          return null;
        });
        if (state?.ready) {
          prepared = true;
          observedAfter = Date.now();
          snapshots.delete(tabId);
        }
      }
      if (
        (prepared ||
          snapshot?.result.kind === 'expired' ||
          snapshot?.result.kind === 'challenge') &&
        snapshot &&
        snapshot.origin === job.origin &&
        snapshot.observedAt >= observedAfter &&
        (!previousDocument || snapshot.documentId !== previousDocument)
      ) {
        result = snapshot.result;
        break;
      }
      if (
        current.status === 'complete' &&
        current.url &&
        new URL(current.url).origin === job.origin
      ) {
        await boundary(() => chrome.tabs.sendMessage(tabId, { type: 'collect' })).catch(
          async () => {
            await inject(tabId, boundary).catch(() => {});
          },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    result ??= {
      kind: 'error',
      message:
        trace.urlReadable === false
          ? '当前页面不在扩展可读取的招聘站点内，可能跳转到了登录页。请点击“检查连接”打开官网确认；已有进度已保留。'
          : '已打开官网，但尚不能识别投递信息。请点击“检查连接”，确认已登录并进入应聘记录页；已有进度已保留。',
    };
    releaseSlot();
    updateLoginBadge(job.origin, result);
    if (result.kind !== 'success')
      void request('/extension/diagnostic', {
        origin: job.origin,
        observedAt: Date.now(),
        readyState: 'worker',
        visibility: 'unknown',
        mainVisible: [],
        isolatedVisible: [],
        candidates: [],
        routes: [],
        campusTabFound: false,
        cards: 0,
        error: JSON.stringify(trace).slice(0, 300),
      }).catch(() => {});
    await request(`/extension/jobs/${job.id}/result`, { origin: job.origin, result });
  } catch (error) {
    releaseSlot();
    await request(`/extension/jobs/${job.id}/result`, {
      origin: job.origin,
      result: {
        kind: 'error',
        message: error instanceof Error ? error.message : '日常 Edge 查询失败。',
      },
    }).catch(() => {});
  } finally {
    releaseSlot();
    inFlight.delete(job.id);
  }
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    void connectSocket();
    const { token, refreshAfterUpdate } = await chrome.storage.local.get([
      'token',
      'refreshAfterUpdate',
    ]);
    if (token) {
      if (refreshAfterUpdate) {
        await request('/extension/start-refresh', {});
        await chrome.storage.local.remove('refreshAfterUpdate');
      }
      const jobs = (await request(
        '/extension/jobs?version=' + AWAIT_OFFER_EXTENSION_VERSION,
      )) as EdgeJob[];
      for (const job of jobs) void run(job);
    }
  } catch {
  } finally {
    polling = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    message?.type === 'diagnostic' &&
    sender.url &&
    sender.tab?.id &&
    allowed(sender.url) &&
    new URL(sender.url).origin === message.data?.origin
  ) {
    void request('/extension/diagnostic', message.data).catch(() => {});
    respond({ ok: true });
    return;
  }
  if (
    message?.type === 'field-map' &&
    sender.url &&
    sender.tab?.id &&
    allowed(sender.url) &&
    new URL(sender.url).origin === message.data?.origin
  ) {
    void (async () => {
      const { token } = await chrome.storage.local.get('token');
      if (typeof token !== 'string') return { map: null, reason: 'rejected' };
      const response = await fetch(edgeBase + '/extension/field-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(message.data),
        signal: AbortSignal.timeout(15000),
      });
      return response.ok ? response.json() : { map: null, reason: 'rejected' };
    })()
      .then((value) => respond(value ?? { map: null, reason: 'rejected' }))
      .catch(() => respond({ map: null, reason: 'rejected' }));
    return true;
  }
  if (message?.type === 'snapshot' && sender.tab?.id && sender.url) {
    const snapshot = message.snapshot as {
      origin: string;
      observedAt: number;
      result: QueryResult;
    };
    if (new URL(sender.url).origin !== snapshot.origin || !allowed(sender.url)) return;
    snapshots.set(sender.tab.id, { ...snapshot, documentId: sender.documentId });
    updateLoginBadge(snapshot.origin, snapshot.result);
    void request('/extension/snapshot', snapshot).catch(() => {});
    respond({ ok: true });
  } else if (message?.type === 'poll') {
    void poll();
    respond({ ok: true });
  }
});
chrome.alarms.create('awaitoffer-poll', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'awaitoffer-poll') void poll();
});
setInterval(() => void poll(), 2000);
void poll();
