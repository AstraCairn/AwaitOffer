import { parseMihoyoRows } from '../../server/adapters';
import { deliveryTimeText } from '../../shared/field-map';
import { normalizeAppliedAt, type RemoteApplication } from '../../shared/model';
export const jdCardTitle = (card: Element) =>
  card.querySelector('[class*="position___"]') ??
  card.querySelector(':scope > div:first-child > span:first-child');
export const jdDeliveryCards = () =>
  [...document.querySelectorAll('[class*="listItem___"]')].filter(
    (card) => !!jdCardTitle(card) && !!card.querySelector('[class*="progressBox___"]'),
  );

/** DOM reads also run in the isolated world, independently of scripts installed by the site. */
export function readVisibleApplications(): RemoteApplication[] {
  if (location.hostname === 'campus.jd.com' && location.hash.startsWith('#/myDeliver')) {
    return jdDeliveryCards().flatMap((card) => {
      const title = jdCardTitle(card);
      if (!title) return [];
      const position = [...title.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join('')
        .replace('（职位已下线）', '')
        .trim();
      const batch = title.querySelector('span')?.textContent?.trim() ?? '';
      const nodes = [
        ...card.querySelectorAll(
          '[class*="progressBox___"] [class*="time___"], [class*="progressBox___"] [class*="statusWrap___"]',
        ),
      ];
      const texts = nodes
        .map((e) => e.textContent?.trim())
        .filter((value): value is string => !!value);
      const statuses = [
        ...new Set(texts.filter((value) => /[一-鿿]/.test(value))),
      ];
      const appliedAt = deliveryTimeText(texts);
      return position && statuses.length === 1
        ? [
            {
              id: `jd-dom:${JSON.stringify([position, batch])}`,
              position,
              batch,
              rawStatus: statuses[0],
              ...(appliedAt ? { appliedAt } : {}),
            },
          ]
        : [];
    });
  }
  if (
    location.hostname === 'talent.antgroup.com' &&
    location.pathname === '/personal/campus-application'
  ) {
    return [...document.querySelectorAll('table')].flatMap((table) => {
      const headings = [...table.querySelectorAll('thead th')].map((e) => e.textContent?.trim());
      if (headings[3] !== '申请编号' || headings[4] !== '当前状态') return [];
      let container: Element | null = table.parentElement,
        batch = '';
      for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
        const names = [...container.querySelectorAll('h3')]
          .map((e) => e.textContent?.trim())
          .filter((name): name is string => !!name && /届.*招聘/.test(name));
        if (names.length === 1) {
          batch = names[0];
          break;
        }
        if (names.length > 1) break;
      }
      if (!batch) {
        const names = [...document.querySelectorAll('h3')]
          .map((e) => e.textContent?.trim())
          .filter((name): name is string => !!name && /届.*招聘/.test(name));
        if (names.length === 1) batch = names[0];
      }
      return [...table.querySelectorAll('tbody tr')].flatMap((row) => {
        const cells = [...row.querySelectorAll(':scope > td')];
        if (cells.length !== 5) return [];
        const id = cells[3].textContent?.trim(),
          position = cells[0].querySelector('a')?.textContent?.trim(),
          rawStatus = cells[4].querySelector('[class*="statusTag"]')?.textContent?.trim();
        const dateAt = headings.indexOf('申请日期');
        const appliedAt =
          dateAt >= 0 ? normalizeAppliedAt(cells[dateAt]?.textContent) : null;
        return id && /^\d{10,}$/.test(id) && position && rawStatus
          ? [{ id, position, batch, rawStatus, ...(appliedAt ? { appliedAt } : {}) }]
          : [];
      });
    });
  }
  if (location.hostname === 'jobs.mihoyo.com' && location.hash.includes('/campus/applyRecord'))
    return parseMihoyoRows(
      [...document.querySelectorAll('table tbody tr[data-row-key]')].map((e) => ({
        id: e.getAttribute('data-row-key'),
        cells: [...e.querySelectorAll('td')].slice(0, 6).map((t) => t.innerText.trim()),
      })),
    );
  if (location.hostname === 'career.honor.com' && /myDeliver/i.test(location.hash)) {
    return [...document.querySelectorAll('[class*="listItem"], [class*="list-item"], [class*="deliverCard"], [class*="deliver-item"]')].flatMap(
      (card) => {
        const position =
          card
            .querySelector('[class*="postName"], [class*="position"], [class*="title"], h3, h4')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim() ?? '';
        const rawStatus =
          [...card.querySelectorAll('[class*="status"], [class*="state"], [class*="progress"]')]
            .map((item) => item.textContent?.replace(/\s+/g, ' ').trim())
            .find((value) => !!value && /[一-鿿]/.test(value) && value !== position) ?? '';
        return position && rawStatus && position.length <= 200 && rawStatus.length <= 200
          ? [{ id: `honor-dom:${JSON.stringify([position])}`, position, batch: '', rawStatus }]
          : [];
      },
    );
  }
  if (location.hostname === 'join.qq.com' && location.pathname.endsWith('/progress.html')) {
    const position = [...document.querySelectorAll('.title_item')]
      .find((item) => item.querySelector('.title_name')?.textContent?.includes('投递岗位'))
      ?.querySelector('.title_lable')
      ?.textContent?.trim();
    const titles = [...document.querySelectorAll('.state_title')]
      .map((item) => item.textContent?.replace(/\s+/g, '') ?? '')
      .map((item) => item.replace(/^当前状态：/, ''))
      .filter((item) => /[一-鿿]/.test(item));
    const preferred = [
      '前序流程已结束，期待新流程再会',
      '三方已签约',
      '三方签约中',
      '确认OFFER',
      '意向签约',
      '确认意向书',
      '录用评估中',
      '用人决策者面试',
      'HR面试',
      '集体面试',
      '复试',
      '初试',
      '简历投递成功，请及时完成测评',
      '测评失效',
      '简历投递成功，测评通知发送失败',
      '简历筛选中',
      '简历投递成功，请保持联系方式畅通',
    ];
    const rawStatus = preferred.find((label) => titles.some((title) => title.includes(label))) ?? titles[0];
    return position && position !== '-' && rawStatus
      ? [{ id: `qq-dom:${position}`, position, batch: '', rawStatus }]
      : [];
  }
  if (location.hostname === 'talent.lenovo.com.cn' && location.pathname.startsWith('/account/apply')) {
    return [...document.querySelectorAll('.list_item')].flatMap((card) => {
      const title = card.querySelector('.list_item_title');
      const position = title
        ? [...title.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join('')
            .trim()
        : '';
      const batch = card.querySelector('.list_item_type span')?.textContent?.trim() ?? '';
      const rawStatus =
        card.querySelector('.message_item_title')?.textContent?.trim() ||
        card.querySelector('.tips_text')?.textContent?.trim() ||
        '';
      return position && rawStatus && /[一-鿿]/.test(rawStatus)
        ? [{ id: `lenovo-dom:${JSON.stringify([position, batch])}`, position, batch, rawStatus }]
        : [];
    });
  }
  if (!location.hostname.endsWith('.jobs.feishu.cn')) return [];
  return [...document.querySelectorAll('.applicationListItem')].flatMap((e) => {
    const title = e.querySelector('.applicationListItem-name-text');
    const position = title
      ? [...title.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join('')
          .trim()
      : '';
    const batch =
      e
        .querySelector('.applicationListItem-subTitle')
        ?.textContent?.match(/项目[：:]\s*(.+)/)?.[1]
        ?.trim() ?? '';
    const rawStatus =
      [...e.querySelectorAll('.step .action')]
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .at(-1) ?? '';
    return position && rawStatus
      ? [{ id: `dom:${JSON.stringify([position, batch])}`, position, batch, rawStatus }]
      : [];
  });
}
