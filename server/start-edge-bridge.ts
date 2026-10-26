import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { edgeBase } from '../shared/edge-protocol.js';
export async function startEdgeBridge(root: string, dataDir: string) {
  const expected = createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0, 16);
  try {
    const health = (await (
      await fetch(edgeBase + '/health', { signal: AbortSignal.timeout(1000) })
    ).json()) as { project?: string };
    if (health.project !== expected) throw new Error('3182 端口被其他服务占用。');
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('占用')) throw error;
  }
  const child: ChildProcess = spawn(
    process.execPath,
    [join(root, 'dist-server', 'server', 'edge-bridge-main.js'), '--parent', String(process.pid)],
    { env: { ...process.env, AWAIT_OFFER_DATA_DIR: dataDir }, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', () => {});
  child.unref();
  for (let n = 0; n < 20; n++) {
    try {
      const health = (await (
        await fetch(edgeBase + '/health', { signal: AbortSignal.timeout(400) })
      ).json()) as { project?: string };
      if (health.project === expected) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('日常 Edge 接入服务启动失败，请检查 3182 端口。');
}
