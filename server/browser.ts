import type { Connection, QueryResult } from '../shared/model.js';
import { queryEdge, openEdge, checkEdge } from './edge-client.js';

export interface BrowserQueries {
  openLogin(connection: Connection): Promise<void>;
  checkLogin(connection: Connection): Promise<QueryResult>;
  query(connection: Connection): Promise<QueryResult>;
  isLoggingIn(id: string): boolean;
  finishLogin?(id: string): Promise<void>;
  close(): Promise<void>;
}

/** Reads recruitment sites through the daily Edge window. No separate browser profile is launched. */
export class BrowserService implements BrowserQueries {
  private loginIds = new Set<string>();
  private closing = false;
  constructor(readonly dataDir: string) {}
  isLoggingIn(id: string) {
    return this.loginIds.has(id);
  }
  async finishLogin(id: string) {
    this.loginIds.delete(id);
  }
  async openLogin(connection: Connection) {
    if (this.closing) throw new Error('服务正在关闭');
    const result = await openEdge(this.dataDir, connection);
    if (result.kind !== 'success') throw new Error(result.message);
    this.loginIds.add(connection.id);
  }
  async checkLogin(connection: Connection): Promise<QueryResult> {
    const result = await checkEdge(this.dataDir, connection);
    if (result.kind === 'success') this.loginIds.delete(connection.id);
    return result;
  }
  async query(connection: Connection): Promise<QueryResult> {
    if (this.closing) return { kind: 'error', message: '服务正在关闭' };
    if (this.loginIds.has(connection.id))
      return {
        kind: 'error',
        message: '官网连接窗口正在使用，请先完成登录；其他公司会继续查询。',
      };
    return queryEdge(this.dataDir, connection);
  }
  async close() {
    this.closing = true;
    this.loginIds.clear();
  }
}
