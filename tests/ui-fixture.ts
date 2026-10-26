/** Isolated UI server. Never opens the real data directory, Edge profile, bridge, or model APIs. */
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { FakeBrowser, input, autoInput } from '../server/test-utils.js';
import type { BookmarkTree } from '../server/bookmarks.js';

process.env.PORT = '0';
const dataDir = mkdtempSync(join(tmpdir(), 'awaitoffer-ui-test-'));
const store = new Store(dataDir);
store.saveSettings({ enabled: false, intervalMinutes: 1440, cohort: 2027, nextRefreshAt: null });
const empty = store.exportBackup();
let tree: BookmarkTree;
function resetTree() {
  tree = {
    roots: {
      bar: {
        id: '1',
        type: 'folder',
        name: '收藏夹栏',
        children: [
          {
            id: '2',
            type: 'folder',
            name: '秋招岗位',
            children: [
              {
                type: 'url',
                name: '测试导入公司',
                url: 'https://recruit.example.com/applications?token=remove-me&tab=campus',
              },
              {
                id: '3',
                type: 'folder',
                name: '研发',
                children: [
                  { type: 'url', name: '测试子目录公司', url: 'https://nested.example.com/apply' },
                ],
              },
            ],
          },
          {
            id: '4',
            type: 'folder',
            name: '研发',
            children: [
              { type: 'url', name: '其他研发公司', url: 'https://other.example.com/apply' },
            ],
          },
          { id: '5', type: 'folder', name: '空文件夹', children: [] },
        ],
      },
    },
  };
}
function seed() {
  const rows = [
    ['星河科技', '大模型应用工程师', '简历筛选中', '业务复试'],
    ['云帆实验室', '前端开发工程师', '简历筛选中', '笔试中'],
    ['远山智能', '算法工程师', '简历筛选中', ''],
    ['棱镜数据', '数据开发工程师', '笔试中', ''],
    ['千帆软件', '后端开发工程师', '一面', ''],
    ['橙光网络', '产品开发工程师', 'Offer 已发放', ''],
    ['清源科技', '平台开发工程师', '人才库', ''],
    ['知行机器人', '机器人算法工程师', '待定', ''],
  ];
  rows.forEach(([company, position, status, changed], index) => {
    const createdAt = new Date(Date.now() - (12 + index) * 86400000).toISOString();
    const app = store.create(
      autoInput({
        company,
        position,
        url: `https://demo-${index}.jobs.feishu.cn/campus/position/application`,
        batch: '2027 届秋招',
        appliedAt: createdAt.slice(0, 10),
      }),
      createdAt,
    );
    store.applyStatus(app.id, status, 'auto', createdAt);
    if (changed)
      store.applyStatus(
        app.id,
        changed,
        'auto',
        new Date(Date.now() - (index + 1) * 3600000).toISOString(),
      );
    store.saveApplication({
      ...store.application(app.id),
      externalId: `demo-${index}`,
      checkState: 'ok',
      lastCheckedAt: new Date(Date.now() - 600000).toISOString(),
      checkMessage: '',
    });
    const connection = store.connection(app.connectionId!);
    store.saveConnection({ ...connection, verifiedAt: new Date().toISOString() });
  });
  store.create(
    input({
      company: '启明设计',
      position: '交互设计师',
      rawStatus: '简历筛选中',
      batch: '2027 届秋招',
    }),
  );
  const apps = store.applications();
  store.saveRun({
    id: randomUUID(),
    startedAt: new Date(Date.now() - 660000).toISOString(),
    finishedAt: new Date(Date.now() - 600000).toISOString(),
    state: 'completed',
    source: 'manual',
    scope: 'all',
    applicationIds: apps.filter((a) => a.mode === 'auto').map((a) => a.id),
    changedIds: apps.filter((a) => a.lastChangeId).map((a) => a.id),
    outcomes: Object.fromEntries(
      apps.filter((a) => a.mode === 'auto').map((a) => [a.id, a.lastChangeId ? 'changed' : 'ok']),
    ),
  });
}
resetTree();
seed();
const { app, refresh } = createApp(store, new FakeBrowser(), async () => tree);
await app.register(fastifyStatic, { root: resolve('dist') });
app.post('/__test/reset', async (request) => {
  if (refresh.active) await refresh.wait();
  store.restore(empty);
  resetTree();
  const scenario = (request.body as { scenario?: string } | undefined)?.scenario;
  if (scenario !== 'empty') seed();
  if (scenario === 'attention') {
    const first = store.applications().find((a) => a.mode === 'auto')!;
    store.setCheck(first.id, 'expired', '演示连接登录已失效，请在官网重新登录。');
  }
  return { ok: true };
});
app.post('/__test/remove-folder', async () => {
  tree = { roots: {} };
  return { ok: true };
});
app.post('/__test/shutdown', async () => {
  setTimeout(() => void app.close(), 50);
  return { ok: true };
});
app.addHook('onClose', async () => {
  const target = resolve(dataDir);
  if (
    !target.startsWith(resolve(tmpdir()) + '\\awaitoffer-ui-test-') &&
    !target.startsWith(resolve(tmpdir()) + '/awaitoffer-ui-test-')
  )
    throw new Error('Unexpected UI fixture path');
  rmSync(target, { recursive: true, force: true });
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('UI fixture did not bind a TCP port');
process.env.PORT = String(address.port);
console.log(`UI_FIXTURE_URL=http://127.0.0.1:${address.port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void app.close());
