import {
  deliveryClocks,
  parseFeishuPayloads,
  parseMokaPayloads,
  parseSitePayloads,
} from '../../server/adapters';
import {
  applyFieldMap,
  datePathsFromShapes,
  FIELD_MAP_NOTE,
  fieldPathsSchema,
  samplesFromPayloads,
  shouldRequestFieldMap,
  summarizeValue,
  type FieldPaths,
  type JsonShape,
} from '../../shared/field-map';
import { detectPlatform, type RemoteApplication, type QueryResult } from '../../shared/model';
import { readVisibleApplications } from './visible';
import { readAccessIssue } from './access';
const win = window as unknown as { __awaitOfferCapture?: boolean };
if (!win.__awaitOfferCapture) {
  win.__awaitOfferCapture = true;
  const responses = new Map<string, unknown>();
  let activeRequests = 0,
    lastNetwork = Date.now(),
    timer: ReturnType<typeof setTimeout> | undefined,
    lastHash = '';
  const began = Date.now();
  let isolatedVisible: RemoteApplication[] = [];
  let candidates: RemoteApplication[] = [],
    lastDiagnosticAt = 0;
  let fieldMapGate: 'idle' | 'wait' | 'done' = 'idle';
  let activePaths: FieldPaths | null = null;
  let pendingNote = '';
  const jdRecordIds = new Set<string>();
  const rememberJDRecord = (url: string) => {
    if (location.hostname !== 'campus.jd.com') return;
    const parsed = new URL(url, location.href);
    if (!parsed.pathname.endsWith('/api/wx/position/delivery/detail')) return;
    const id = parsed.searchParams.get('recordId');
    if (id && /^[A-Za-z0-9_-]{1,512}$/.test(id)) {
      jdRecordIds.add(id);
      schedule();
    }
  };
  const relevant = (url: string) => {
    const path = new URL(url, location.href).pathname;
    if (/login|signin|auth|captcha|validate|verification/i.test(path)) return false;
    if (location.hostname === 'talent.baidu.com') return path.endsWith('/resume/deliver/list/new');
    if (location.hostname === 'campus.jd.com')
      return /\/delivery\/(?:list|officialInfo\/list|detail)$|\/activityDelivery\/queryActivityDeliveryList$/.test(
        path,
      );
    if (location.hostname === 'join.qq.com')
      return /apply|process|progress|deliver|status|offer|interview|assess|campus|position/i.test(
        path,
      );
    if (location.hostname === 'career.honor.com')
      return /\/(?:api|pb|gateway)\b|deliver|apply|progress|process|post|record|query|list|flow|status|job/i.test(
        path,
      );
    if (
      /resume|profile|attachment|education|portfolio|contact/i.test(path) &&
      !/application|delivery|deliver|apply/i.test(path)
    )
      return false;
    return /application|delivery|deliver|apply|submission|progress|process|candidate|query|list|record/i.test(
      path,
    );
  };
  const applicationBody = (url: string, body: unknown) => {
    if (!/\/process\/getProcessStatusForCR/.test(url)) return undefined;
    try {
      const value = typeof body === 'string' ? JSON.parse(body) : body;
      const id = value?.applicationProfileId;
      if (typeof id === 'string' || typeof id === 'number') return { applicationProfileId: id };
    } catch {}
    return undefined;
  };
  const remember = (url: string, value: unknown, body?: unknown) => {
    let responseKey = new URL(url, location.href).href;
    if (
      /\/process\/getProcessStatusForCR/.test(url) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        const id = parsed?.applicationProfileId;
        if (typeof id === 'number' || typeof id === 'string') {
          value = { ...value, __awaitofferApplicationId: String(id) };
          responseKey += ':' + id;
        }
      } catch {}
    }
    responses.set(responseKey, value);
    if (responses.size > 100) responses.delete(responses.keys().next().value!);
    lastNetwork = Date.now();
    schedule();
  };
  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url =
      typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
    const track = relevant(url);
    if (track) activeRequests++;
    try {
      const response = await originalFetch.apply(this, args);
      if (track && response.ok) rememberJDRecord(url);
      const responseType = response.headers.get('content-type') ?? '';
      if (track && !/html|css|image|font|video|audio/i.test(responseType))
        void response
          .clone()
          .json()
          .then((value) => remember(url, value, applicationBody(url, args[1]?.body)))
          .catch(() => {});
      return response;
    } finally {
      if (track) {
        activeRequests--;
        lastNetwork = Date.now();
        schedule();
      }
    }
  };
  const originalOpen = XMLHttpRequest.prototype.open,
    originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { url: string; body?: unknown }>();
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (relevant(String(url))) requests.set(this, { url: String(url) });
    else requests.delete(this);
    return (originalOpen as unknown as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest,
    );
  } as typeof originalOpen;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const info = requests.get(this);
    if (info) info.body = applicationBody(info.url, body);
    if (info && relevant(info.url)) {
      activeRequests++;
      this.addEventListener(
        'loadend',
        () => {
          activeRequests--;
          lastNetwork = Date.now();
          if (this.status >= 200 && this.status < 300) rememberJDRecord(info.url);
          try {
            const responseType = this.getResponseHeader('content-type') ?? '';
            if (!/html|css|image|font|video|audio/i.test(responseType))
              remember(
                info.url,
                this.responseType === 'json' ? this.response : JSON.parse(this.responseText),
                info.body,
              );
          } catch {}
          schedule();
        },
        { once: true },
      );
    }
    return originalSend.call(this, body);
  };
  const empty = () =>
    [...responses.values()].some((v) => {
      const p = v as {
        code?: number;
        data?: {
          delivery_list?: unknown[];
          applications?: unknown[];
          headerInfo?: { applicationCount?: number };
        };
      };
      return (
        (p?.code === 0 &&
          Array.isArray(p.data?.delivery_list) &&
          p.data.delivery_list.length === 0) ||
        (p?.data?.headerInfo?.applicationCount === 0 &&
          Array.isArray(p.data.applications) &&
          !p.data.applications.length)
      );
    });
  const collect = (): QueryResult | null => {
    const text = document.body?.innerText ?? '';
    const accessIssue = readAccessIssue();
    if (accessIssue) return accessIssue;
    const ownVisible = readVisibleApplications();
    const baiduCampusLoaded = [...responses.keys()].some((url) => {
      const parsed = new URL(url, location.href);
      return (
        parsed.pathname.endsWith('/resume/deliver/list/new') &&
        parsed.searchParams.get('recruitType')?.includes('GRADUATE')
      );
    });
    if (location.hostname === 'talent.baidu.com' && !baiduCampusLoaded) return null;
    const shown = isolatedVisible.length ? isolatedVisible : ownVisible,
      platform = detectPlatform(location.href),
      payloads = [...responses.values()];
    let applications =
      platform === 'feishu'
        ? parseFeishuPayloads(payloads, shown)
        : platform === 'moka'
          ? parseMokaPayloads(payloads, shown)
          : parseSitePayloads(payloads, location.hostname, shown);
    if (
      !applications.length &&
      [
        'jobs.mihoyo.com',
        'talent.antgroup.com',
        'join.qq.com',
        'talent.lenovo.com.cn',
        'career.honor.com',
      ].includes(location.hostname)
    )
      applications = shown;
    if (location.hostname === 'campus.jd.com') {
      const recordId = jdRecordIds.size === 1 ? [...jdRecordIds][0] : undefined;
      if (!applications.length && shown.length) {
        if (shown.length === 1 && recordId) applications = [{ ...shown[0], id: recordId }];
        else if (jdRecordIds.size === 0) applications = shown;
      } else if (recordId && shown.length <= 1) {
        applications = applications.map((app) =>
          app.id.startsWith('jd-dom:') ? { ...app, id: recordId } : app,
        );
      }
    }
    const clocks = deliveryClocks(payloads);
    if (clocks.size)
      applications = applications.map((app) =>
        app.appliedAt || !clocks.has(app.position)
          ? app
          : { ...app, appliedAt: clocks.get(app.position) },
      );
    applications = applications.map((app) => {
      if (app.appliedAt) return app;
      const matches = shown.filter(
        (row) =>
          !!row.appliedAt &&
          (row.id === app.id ||
            (row.position === app.position &&
              (!app.batch || !row.batch || app.batch === row.batch))),
      );
      return matches.length === 1 ? { ...app, appliedAt: matches[0].appliedAt } : app;
    });
    if (activePaths) applications = applyFieldMap(payloads, applications, activePaths);
    const finish = (rows: RemoteApplication[]): QueryResult => {
      const note = pendingNote && rows.some((app) => !app.appliedAt) ? pendingNote : undefined;
      return {
        kind: 'success',
        applications: rows,
        applicationUrl: location.href,
        ...(note ? { note } : {}),
      };
    };
    candidates = applications;
    if (
      applications.length &&
      (applications.every((a) => a.rawStatus) ||
        (Date.now() - began > 20000 && Date.now() - lastNetwork > 2000))
    )
      return finish(applications);
    if (
      !activeRequests &&
      Date.now() - began > 5000 &&
      Date.now() - lastNetwork > 1000 &&
      (empty() ||
        (/暂无应聘记录|暂无投递记录|暂无申请记录|没有相关记录|你还没有申请职位/.test(text) &&
          /你好|退出|个人中心|应聘记录/.test(text)))
    )
      return finish([]);
    return null;
  };
  function responseShapes(): JsonShape[] {
    return [...responses.entries()].slice(-20).map(([url, value]) => ({
      route: new URL(url, location.href).pathname,
      fields: summarizeValue(value),
    }));
  }
  function emit(force = false) {
    if (fieldMapGate === 'wait') return;
    let result: QueryResult | null = null,
      error = '';
    try {
      result = collect();
    } catch (cause) {
      error = (cause instanceof Error ? cause.message : '页面采集失败').slice(0, 300);
      result = { kind: 'error', message: '页面采集失败：' + error.slice(0, 120) };
      force = true;
    }
    const shapes = responseShapes();
    if (force && Date.now() - lastDiagnosticAt > 3000) {
      lastDiagnosticAt = Date.now();
      const missingTime =
        result?.kind === 'success' && result.applications.some((app) => !app.appliedAt);
      window.postMessage(
        {
          type: 'awaitoffer:diagnostic',
          data: {
            origin: location.origin,
            observedAt: Date.now(),
            readyState: document.readyState,
            visibility: document.visibilityState,
            error,
            mainVisible: (() => {
              try {
                return readVisibleApplications();
              } catch {
                return [];
              }
            })(),
            isolatedVisible,
            candidates,
            routes: [...responses.keys()]
              .map((url) => new URL(url, location.href).pathname)
              .slice(-100),
            shapes,
            datePaths:
              location.hostname.endsWith('.jobs.feishu.cn') && missingTime
                ? datePathsFromShapes(shapes)
                : [],
            campusTabFound: !![
              ...document.querySelectorAll('[class*="delivery-record"] [class*="tab"] *'),
            ].find((e) => e.children.length === 0 && e.textContent?.trim() === '校园招聘'),
            cards: document.querySelectorAll(
              '.applicationListItem,table tbody tr,[class*="list-item"]',
            ).length,
          },
        },
        location.origin,
      );
    }
    if (!result) return;
    if (
      result.kind === 'success' &&
      fieldMapGate === 'idle' &&
      shouldRequestFieldMap(location.href, result.applications, shapes)
    ) {
      fieldMapGate = 'wait';
      window.postMessage(
        {
          type: 'awaitoffer:progress',
          result,
          fieldMap: { shapes, samples: samplesFromPayloads([...responses.values()]) },
        },
        location.origin,
      );
      return;
    }
    const hash = JSON.stringify(result);
    if (!force && hash === lastHash) return;
    lastHash = hash;
    window.postMessage(
      { type: 'awaitoffer:progress', result, observedAt: Date.now() },
      location.origin,
    );
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => emit(), 350);
  }
  window.addEventListener('message', (e) => {
    if (
      e.source === window &&
      e.origin === location.origin &&
      e.data?.type === 'awaitoffer:field-map'
    ) {
      const parsed = fieldPathsSchema.safeParse(e.data.map);
      activePaths = parsed.success ? parsed.data : null;
      pendingNote = e.data.note === FIELD_MAP_NOTE ? FIELD_MAP_NOTE : '';
      fieldMapGate = 'done';
      emit(true);
      return;
    }
    if (
      e.source === window &&
      e.origin === location.origin &&
      e.data?.type === 'awaitoffer:collect'
    ) {
      // Validation that can compile code belongs in the isolated world, beyond the site's CSP and globals.
      if (Array.isArray(e.data.visible))
        isolatedVisible = e.data.visible
          .slice(0, 1000)
          .filter(
            (row: unknown): row is RemoteApplication =>
              !!row &&
              typeof row === 'object' &&
              ['id', 'position', 'batch', 'rawStatus'].every(
                (key) => typeof (row as Record<string, unknown>)[key] === 'string',
              ),
          )
          .map((row: RemoteApplication) => ({
            id: row.id,
            position: row.position,
            batch: row.batch,
            rawStatus: row.rawStatus,
            ...(typeof row.appliedAt === 'string' && row.appliedAt
              ? { appliedAt: row.appliedAt }
              : {}),
          }));
      emit(true);
    }
  });
  const observe = () => {
    if (document.body)
      new MutationObserver(schedule).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    schedule();
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  else observe();
  setInterval(() => emit(), 2000);
}
