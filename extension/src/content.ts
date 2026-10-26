import { FIELD_MAP_NOTE } from '../../shared/field-map';
import { edgeResultSchema } from '../../shared/edge-protocol';
import { readVisibleApplications, jdDeliveryCards } from './visible';
import { readAccessIssue } from './access';
const isolated = window as unknown as { __awaitOfferIsolated?: boolean };
if (!isolated.__awaitOfferIsolated) {
  isolated.__awaitOfferIsolated = true;
  let last: unknown;
  let visibleHash = '';
  const collect = (force = false) => {
    const issue = readAccessIssue();
    if (issue) {
      last = { origin: location.origin, observedAt: Date.now(), result: issue };
      void chrome.runtime.sendMessage({ type: 'snapshot', snapshot: last }).catch(() => {});
      return;
    }
    const visible = readVisibleApplications(),
      hash = JSON.stringify(visible);
    if (!force && visibleHash === hash) return;
    visibleHash = hash;
    window.postMessage({ type: 'awaitoffer:collect', visible }, location.origin);
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === 'awaitoffer:diagnostic') {
      void chrome.runtime
        .sendMessage({ type: 'diagnostic', data: event.data.data })
        .catch(() => {});
      return;
    }
    if (event.data?.type !== 'awaitoffer:progress') return;
    const parsed = edgeResultSchema.safeParse(event.data.result);
    if (!parsed.success) return;
    const publish = (result: typeof parsed.data) => {
      last = { origin: location.origin, observedAt: Date.now(), result };
      void chrome.runtime.sendMessage({ type: 'snapshot', snapshot: last }).catch(() => {});
    };
    const request = event.data.fieldMap as { shapes?: unknown; samples?: unknown } | undefined;
    if (!request) {
      publish(parsed.data);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      publish(parsed.data);
    }, 14000);
    void chrome.runtime
      .sendMessage({
        type: 'field-map',
        data: { origin: location.origin, shapes: request.shapes, samples: request.samples },
      })
      .then((response: { map?: unknown; reason?: string } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.postMessage(
          {
            type: 'awaitoffer:field-map',
            map: response?.map ?? null,
            note: response?.reason === 'unconfigured' ? FIELD_MAP_NOTE : '',
          },
          location.origin,
        );
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        publish(parsed.data);
      });
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'collect') {
      collect(true);
      respond(last ?? null);
    } else if (message?.type === 'prepare') {
      if (location.hostname === 'campus.jd.com') {
        const cards = jdDeliveryCards();
        if (cards.length !== 1) {
          respond({ ready: false });
          return;
        }
        const detail = [...cards[0].querySelectorAll('button,a,div,span')].find(
          (e) => e.children.length === 0 && e.textContent?.trim() === '投递详情',
        );
        if (detail instanceof HTMLElement) {
          detail.click();
          respond({ ready: true });
        } else respond({ ready: false });
        return;
      }
      if (location.hostname !== 'talent.baidu.com') {
        respond({ ready: true });
        return;
      }
      const root = document.querySelector('[class*="delivery-record"]');
      const tab =
        root &&
        [...root.querySelectorAll('[class*="tab"] *')].find(
          (e) => e.children.length === 0 && e.textContent?.trim() === '校园招聘',
        );
      if (tab instanceof HTMLElement) {
        tab.click();
        respond({ ready: true });
      } else respond({ ready: false });
    }
  });
  const watch = () => {
    if (document.body)
      new MutationObserver(() => collect()).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    collect(true);
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
}
