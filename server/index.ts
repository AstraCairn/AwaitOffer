import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import fastifyStatic from '@fastify/static';
import { Store } from './store.js';
import { createApp } from './app.js';
import { startEdgeBridge } from './start-edge-bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(
  here,
  here.endsWith('dist-server\\server') || here.endsWith('dist-server/server') ? '../..' : '..',
);
const dataDir = process.env.AWAIT_OFFER_DATA_DIR
  ? resolve(process.env.AWAIT_OFFER_DATA_DIR)
  : resolve(root, 'data');
const store = new Store(dataDir);
const { app } = createApp(store);
let edgeChild: Awaited<ReturnType<typeof startEdgeBridge>> = null;
app.addHook('preClose', async () => {
  edgeChild?.kill();
});
const staticRoot = resolve(root, 'dist');
if (existsSync(staticRoot)) {
  await app.register(fastifyStatic, { root: staticRoot });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/')
      ? reply.code(404).send({ message: '接口不存在' })
      : reply.sendFile('index.html'),
  );
} else
  app.get('/', async () => ({
    message: '请先运行 npm run build，开发模式访问 http://127.0.0.1:5173。',
  }));
const port = Number(process.env.PORT ?? 3180);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT 必须是 1–65535 的整数。');
if (port === 3182) throw new Error('3182 为日常 Edge 接入服务保留，请使用 3180 或其他端口。');
try {
  if (process.env.AWAIT_OFFER_NO_EDGE_BRIDGE !== '1')
    edgeChild = await startEdgeBridge(root, dataDir);
  await app.listen({ host: '127.0.0.1', port });
  const url = `http://127.0.0.1:${port}`;
  console.log(`\nAwaitOffer 已启动：${url}\n数据保存于：${dataDir}\n按 Ctrl+C 停止。\n`);
  const distIndex = resolve(staticRoot, 'index.html');
  const srcApp = resolve(root, 'src/App.tsx');
  if (
    existsSync(distIndex) &&
    existsSync(srcApp) &&
    statSync(distIndex).mtimeMs < statSync(srcApp).mtimeMs
  )
    console.warn('前端 dist 早于 src/App.tsx。请先运行 npm run build，否则页面仍是旧版。');
  if (
    !process.argv.includes('--no-open') &&
    process.env.AWAIT_OFFER_NO_OPEN !== '1' &&
    process.platform === 'win32'
  ) {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => console.log(`请在浏览器中打开 ${url}`));
    child.unref();
  }
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用。请检查已有 AwaitOffer 窗口，或设置 PORT 后重新启动。`
      : '启动失败：' + (error as Error).message,
  );
  await app.close();
  process.exitCode = 1;
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app
      .close()
      .then(() => {
        process.exitCode = 0;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  });
