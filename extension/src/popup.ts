import { edgeBase } from '../../shared/edge-protocol';
declare const AWAIT_OFFER_EXTENSION_VERSION: string;
const status = document.querySelector('#status')!;
const needsReload = chrome.runtime.getManifest().version !== AWAIT_OFFER_EXTENSION_VERSION;
if (needsReload) {
  document.querySelector<HTMLButtonElement>('#connect')!.textContent = '更新并连接 AwaitOffer';
  status.textContent = '有本地更新。点击按钮加载新版，招聘页面会保留。';
}
document.querySelector<HTMLButtonElement>('#connect')!.onclick = async () => {
  status.textContent = '正在连接本地面板…';
  try {
    if (needsReload) {
      await chrome.storage.local.set({ refreshAfterUpdate: true });
      chrome.runtime.reload();
      return;
    }
    const setup = await (await fetch(edgeBase + '/api/setup')).json();
    const response = await fetch(edgeBase + '/extension/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: setup.pairCode, extensionId: chrome.runtime.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    await chrome.storage.local.set({ token: data.token });
    await chrome.runtime.sendMessage({ type: 'poll' });
    const refresh = await fetch(edgeBase + '/extension/start-refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.token}` },
    });
    if (!refresh.ok) throw new Error('浏览器已连接，但首次查询未启动，请在面板点击刷新。');
    status.textContent = '已连接，首次查询已启动。回到面板可查看各家公司结果。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '请先启动 AwaitOffer 本地服务。';
  }
};
void chrome.storage.local.get('token').then(({ token }) => {
  if (token && !needsReload)
    status.textContent = '已保存连接。请保持日常 Edge 打开，在面板触发刷新。';
});
