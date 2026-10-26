import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { edgeBase, edgeResultSchema } from '../shared/edge-protocol.js';
import type { Connection, QueryResult } from '../shared/model.js';
export async function edgeRequest(
  dataDir: string,
  path: string,
  body?: unknown,
): Promise<QueryResult> {
  try {
    const credentials = JSON.parse(await readFile(join(dataDir, 'edge-bridge.json'), 'utf8')) as {
      internalToken: string;
    };
    const response = await fetch(edgeBase + '/internal' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.internalToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(34000),
    });
    const value: unknown = await response.json();
    if (!response.ok)
      return {
        kind: 'error',
        message: (value as { message?: string }).message ?? '日常 Edge 接入暂不可用。',
      };
    return edgeResultSchema.parse(value);
  } catch {
    return {
      kind: 'error',
      message:
        '日常 Edge 扩展未连接。请保持 Edge 打开，并在扩展中连接 AwaitOffer。已有进度已保留。',
    };
  }
}
export const queryEdge = (dataDir: string, c: Connection) =>
  edgeRequest(dataDir, '/query', { connectionId: c.id });
export const openEdge = (dataDir: string, c: Connection) =>
  edgeRequest(dataDir, '/open', { connectionId: c.id });
export const checkEdge = (dataDir: string, c: Connection) =>
  edgeRequest(dataDir, `/snapshot/${c.id}`);
