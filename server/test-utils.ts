import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from './store.js';
import type { ApplicationInput, Connection, QueryResult } from '../shared/model.js';
import type { BrowserQueries } from './browser.js';

export function temporaryStore() {
  const path = mkdtempSync(join(tmpdir(), 'awaitoffer-test-'));
  const store = new Store(path);
  const remove = () => {
    if (
      !resolve(path).startsWith(resolve(tmpdir()) + '\\awaitoffer-test-') &&
      !resolve(path).startsWith(resolve(tmpdir()) + '/awaitoffer-test-')
    )
      throw new Error('Unexpected temporary path');
    rmSync(path, { recursive: true, force: true });
  };
  return { store, path, remove };
}
export function input(overrides: Partial<ApplicationInput> = {}): ApplicationInput {
  return {
    company: '测试公司',
    position: '前端工程师',
    batch: '秋招正式批',
    url: 'https://example.com/personal',
    mode: 'manual',
    platform: 'custom',
    rawStatus: '简历初筛',
    appliedAt: null,
    stageOverride: null,
    ...overrides,
  };
}
export function autoInput(overrides: Partial<ApplicationInput> = {}): ApplicationInput {
  return input({
    url: 'https://test.jobs.feishu.cn/campus/position/application',
    mode: 'auto',
    platform: 'feishu',
    rawStatus: '',
    ...overrides,
  });
}
export class FakeBrowser implements BrowserQueries {
  result: QueryResult = {
    kind: 'success',
    applications: [
      { id: 'application-1', position: '前端工程师', batch: '秋招正式批', rawStatus: '初筛' },
    ],
  };
  open = new Set<string>();
  calls: string[] = [];
  async openLogin(connection: Connection) {
    this.open.add(connection.id);
  }
  async checkLogin(connection: Connection) {
    this.open.delete(connection.id);
    return this.result;
  }
  async query(connection: Connection) {
    this.calls.push(connection.id);
    return this.result;
  }
  isLoggingIn(id: string) {
    return this.open.has(id);
  }
  async close() {
    this.open.clear();
  }
}
