import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Store } from './store.js';
import { createEdgeBridge } from './edge-bridge.js';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(
  here,
  here.endsWith('dist-server\\server') || here.endsWith('dist-server/server') ? '../..' : '..',
);
const dataDir = process.env.AWAIT_OFFER_DATA_DIR
  ? resolve(process.env.AWAIT_OFFER_DATA_DIR)
  : resolve(root, 'data');
const { app, port, useEdge } = createEdgeBridge(new Store(dataDir, false), root);
useEdge();
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`AwaitOffer 日常 Edge 接入已启动：${port}`);
} catch (error) {
  await app.close();
  console.error((error as Error).message);
  process.exitCode = 1;
}
const parentIndex = process.argv.indexOf('--parent');
if (parentIndex >= 0) {
  const parentPid = Number(process.argv[parentIndex + 1]);
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(timer);
      void app.close();
    }
  }, 5000);
  timer.unref();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
