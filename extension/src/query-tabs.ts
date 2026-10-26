/** Only manages tabs created by this extension. Daily browsing tabs are never moved or navigated. */
type State = {
  windowId?: number;
  anchorId?: number;
  slots: number[];
  manual: Record<string, number>;
};
type Boundary = <T>(action: () => Promise<T>) => Promise<T>;
export function createQueryTabs() {
  let queue = Promise.resolve();
  const busy = new Set<number>();
  const locked = <T>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(action, action);
    queue = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const load = async (boundary: Boundary): Promise<State> => {
    const { queryWindow } = await boundary(() => chrome.storage.local.get('queryWindow'));
    const saved = queryWindow as Partial<State> | undefined;
    const state: State = {
      windowId: typeof saved?.windowId === 'number' ? saved.windowId : undefined,
      anchorId: typeof saved?.anchorId === 'number' ? saved.anchorId : undefined,
      slots: Array.isArray(saved?.slots) ? saved.slots.filter(Number.isInteger) : [],
      manual: saved?.manual && typeof saved.manual === 'object' ? saved.manual : {},
    };
    if (state.windowId !== undefined) {
      try {
        await boundary(() => chrome.windows.get(state.windowId!));
        const anchor =
          state.anchorId === undefined
            ? undefined
            : await boundary(() => chrome.tabs.get(state.anchorId!));
        if (
          anchor?.windowId !== state.windowId ||
          anchor.url !== chrome.runtime.getURL('workspace.html')
        )
          return { slots: [], manual: {} };
      } catch {
        return { slots: [], manual: {} };
      }
    }
    return state;
  };
  const save = (state: State, boundary: Boundary) =>
    boundary(() => chrome.storage.local.set({ queryWindow: state }));
  const ensureWindow = async (state: State, boundary: Boundary) => {
    if (state.windowId !== undefined) return;
    const window = await boundary(() =>
      chrome.windows.create({
        url: chrome.runtime.getURL('workspace.html'),
        type: 'normal',
        focused: false,
        state: 'normal',
      }),
    );
    if (window?.id === undefined || !window.tabs?.[0]?.id)
      throw new Error('无法创建 AwaitOffer 查询窗口。');
    state.windowId = window.id;
    state.anchorId = window.tabs[0].id;
    state.slots = [];
    await save(state, boundary);
  };
  const getOwned = async (id: number, state: State, boundary: Boundary) => {
    try {
      const tab = await boundary(() => chrome.tabs.get(id));
      return tab.windowId === state.windowId ? tab : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    reserve: (boundary: Boundary) =>
      locked(async () => {
        const deadline = Date.now() + 120_000;
        while (busy.size >= 3) {
          if (Date.now() >= deadline) throw new Error('查询窗口正在忙，请稍后刷新。');
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const state = await load(boundary);
        await ensureWindow(state, boundary);
        const window = await boundary(() => chrome.windows.get(state.windowId!));
        if (window.state === 'minimized')
          await boundary(() =>
            chrome.windows.update(state.windowId!, { state: 'normal', focused: false }),
          );
        let available: chrome.tabs.Tab | undefined;
        for (const id of [...state.slots]) {
          const tab = await getOwned(id, state, boundary);
          // A tab the user has brought to the foreground becomes theirs to keep.
          if (!tab || (tab.active && window.focused)) {
            state.slots = state.slots.filter((slot) => slot !== id);
            continue;
          }
          if (!busy.has(id)) available ??= tab;
        }
        if (!available) {
          if (state.slots.length >= 3) throw new Error('查询窗口正在忙，请稍后刷新。');
          available = await boundary(() =>
            chrome.tabs.create({ windowId: state.windowId, url: 'about:blank', active: false }),
          );
          if (available.id) state.slots.push(available.id);
        }
        if (!available.id) throw new Error('无法创建查询标签页。');
        await save(state, boundary);
        busy.add(available.id);
        return available;
      }),
    release: (id: number) => {
      busy.delete(id);
    },
    open: (origin: string, url: string, boundary: Boundary) =>
      locked(async () => {
        const state = await load(boundary);
        await ensureWindow(state, boundary);
        let tab = state.manual[origin]
          ? await getOwned(state.manual[origin], state, boundary)
          : undefined;
        if (!tab) {
          for (const id of state.slots) {
            if (busy.has(id)) continue;
            const candidate = await getOwned(id, state, boundary);
            if (candidate?.url?.startsWith(origin + '/')) {
              tab = candidate;
              break;
            }
          }
        }
        if (!tab)
          tab = await boundary(() =>
            chrome.tabs.create({ windowId: state.windowId, url, active: true }),
          );
        if (!tab.id) throw new Error('无法打开登录页面。');
        // Keep a verification page exactly where it is; don't reload it on repeated clicks.
        await boundary(() => chrome.tabs.update(tab!.id!, { active: true }));
        state.slots = state.slots.filter((id) => id !== tab!.id);
        state.manual[origin] = tab.id;
        await save(state, boundary);
        await boundary(() =>
          chrome.windows.update(state.windowId!, { state: 'normal', focused: true }),
        );
        return tab;
      }),
  };
}
