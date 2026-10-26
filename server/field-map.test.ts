import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyFieldMap,
  builtinFieldMaps,
  deliveryTimeText,
  shouldRequestFieldMap,
  type FieldMapSample,
  type JsonShape,
} from '../shared/field-map.js';
import { createApp } from './app.js';
import { createEdgeBridge } from './edge-bridge.js';
import { resolveFieldMap } from './field-map.js';
import { writeLlmKey } from './llm-key.js';
import { RefreshService } from './refresh.js';
import { autoInput, FakeBrowser, temporaryStore } from './test-utils.js';

const shapes: JsonShape[] = [
  {
    route: '/api/list',
    fields: [
      { path: 'data.items', type: 'array' },
      { path: 'data.items[]', type: 'object' },
      { path: 'data.items[].applyNumber', type: 'string' },
      { path: 'data.items[].position', type: 'string' },
      { path: 'data.items[].status', type: 'string' },
      { path: 'data.items[].applyTime', type: 'string' },
      { path: 'data.items[].batchName', type: 'string' },
    ],
  },
];
const samples: FieldMapSample[] = [
  {
    list: 'data.items',
    values: {
      applyNumber: 'string',
      position: 'AI应用研发工程师',
      status: '已结束',
      applyTime: '2026-10-01 08:30',
      batchName: '2027届秋招',
    },
  },
];
const mapped = JSON.stringify({
  list: 'data.items',
  id: 'applyNumber',
  position: 'position',
  status: 'status',
  appliedAt: 'applyTime',
  batch: 'batchName',
});

describe('field maps', () => {
  it('fills Huawei delivery time without replacing the progress text', () => {
    const paths = builtinFieldMaps[0].paths;
    const payloads = [
      {
        data: {
          items: [
            {
              applicationProfileId: 11,
              externalJobName: 'AI技术应用',
              applicationStatus: '1',
              applicationTime: '2026-10-01 08:30',
              recruitSceneName: '应届生',
            },
          ],
        },
      },
    ];
    expect(
      applyFieldMap(
        payloads,
        [{ id: '11', position: 'AI技术应用', batch: '应届生', rawStatus: '考试&测评 - 已完成' }],
        paths,
      ),
    ).toEqual([
      {
        id: '11',
        position: 'AI技术应用',
        batch: '应届生',
        rawStatus: '考试&测评 - 已完成',
        appliedAt: '2026-10-01 08:30',
      },
    ]);
    expect(applyFieldMap(payloads, [], paths)).toEqual([]);
    expect(deliveryTimeText(['简历筛选中', '2026-10-02 09:00'])).toBe('2026-10-02 09:00');
    expect(
      shouldRequestFieldMap('https://career.example.com/jobs', [], [
        {
          route: '/jobs',
          fields: [
            { path: 'jobs', type: 'array' },
            { path: 'jobs[].title', type: 'string' },
            { path: 'jobs[].publishTime', type: 'string' },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      shouldRequestFieldMap(
        'https://career.example.com/applications',
        [{ id: '1', position: '工程师', batch: '', rawStatus: '初筛' }],
        shapes,
      ),
    ).toBe(true);
  });
  it('stores one LLM map per structure and does not call again for the same fingerprint', async () => {
    const { store, path, remove } = temporaryStore();
    let calls = 0;
    const model = async () => {
      calls += 1;
      return mapped;
    };
    try {
      const first = await resolveFieldMap(store, 'https://career.example.com', shapes, samples, model);
      const second = await resolveFieldMap(store, 'https://career.example.com', shapes, samples, model);
      expect(first).toMatchObject({ reason: 'ready', map: { appliedAt: 'applyTime' } });
      expect(second.reason).toBe('cached');
      expect(calls).toBe(1);
      expect(store.fieldMapCount()).toBe(1);
      writeLlmKey(path, 'xai-test-key-should-not-export');
      store.saveFieldMap({
        host: 'career.example.com',
        fingerprint: 'same',
        paths: { ...builtinFieldMaps[0].paths, position: '字段对照哨兵' },
        source: 'llm',
      });
      store.saveFieldMap({
        host: 'career.example.com',
        fingerprint: 'same',
        paths: builtinFieldMaps[0].paths,
        source: 'llm',
      });
      expect(store.fieldMapCount()).toBe(2);
      const backup = JSON.stringify(store.exportBackup());
      expect(backup).not.toContain('字段对照哨兵');
      expect(backup).not.toContain('xai-test-key-should-not-export');
      expect(readFileSync(join(path, 'llm.json'), 'utf8')).toContain('xai-test-key-should-not-export');
    } finally {
      store.close();
      remove();
    }
  });
  it('rejects a missing path or a numeric status and skips known recruitment platforms', async () => {
    const { store, remove } = temporaryStore();
    let calls = 0;
    const model = async (prompt: string) => {
      calls += 1;
      expect(prompt).not.toContain('secret-key');
      return JSON.stringify({ ...JSON.parse(mapped), status: 'notAField' });
    };
    try {
      expect(
        (await resolveFieldMap(store, 'https://career.example.com', shapes, samples, model)).reason,
      ).toBe('rejected');
      expect(
        (
          await resolveFieldMap(
            store,
            'https://career.example.com',
            shapes,
            [{ ...samples[0], values: { ...samples[0].values, status: '2' } }],
            async () => mapped,
          )
        ).reason,
      ).toBe('rejected');
      expect(
        (
          await resolveFieldMap(store, 'https://dcar.jobs.feishu.cn', shapes, samples, async () => {
            calls += 1;
            return mapped;
          })
        ).reason,
      ).toBe('known-platform');
      expect(
        (
          await resolveFieldMap(
            store,
            'https://career.huawei.com',
            [
              {
                route: '/api/list',
                fields: [
                  { path: 'data.items', type: 'array' },
                  { path: 'data.items[].applicationTime', type: 'string' },
                  { path: 'data.items[].externalJobName', type: 'string' },
                ],
              },
            ],
            [],
            async () => {
              calls += 1;
              return mapped;
            },
          )
        ).reason,
      ).toBe('builtin');
      expect(calls).toBe(1);
      expect(store.fieldMapCount()).toBe(0);
    } finally {
      store.close();
      remove();
    }
  });
  it('keeps the unconfigured note on a matched record that still has no delivery time', () => {
    const { store, remove } = temporaryStore();
    const service = new RefreshService(store, new FakeBrowser());
    try {
      const app = store.create(
        autoInput({
          url: 'https://campus.kuaishou.cn/recruit/campus/e/',
          company: '快手',
        }),
      );
      service.bind(app.id, { id: 'remote-1', position: '工程师', batch: '秋招正式批', rawStatus: '初筛' });
      service.applyResult(app.id, {
        kind: 'success',
        note: '这个官网的字段还没对照',
        applications: [{ id: 'remote-1', position: '工程师', batch: '秋招正式批', rawStatus: '初筛' }],
      });
      expect(store.application(app.id).rawStatus).toBe('初筛');
      expect(store.application(app.id).checkMessage).toBe('这个官网的字段还没对照');
      expect(store.application(app.id).appliedAt).toBeNull();
    } finally {
      store.close();
      remove();
    }
  });
  it('saves the API key on this machine and does not return it', async () => {
    const { store, path, remove } = temporaryStore();
    const runtime = createApp(store, new FakeBrowser());
    await runtime.app.ready();
    try {
      const saved = await runtime.app.inject({
        method: 'PUT',
        url: '/api/llm',
        headers: { host: '127.0.0.1:3180' },
        payload: { apiKey: 'xai-test-key-should-not-export' },
      });
      expect(saved.json()).toEqual({ configured: true });
      const status = (
        await runtime.app.inject({ url: '/api/llm', headers: { host: '127.0.0.1:3180' } })
      ).json();
      expect(status).toEqual({ configured: true });
      expect(JSON.stringify(status)).not.toContain('xai-test-key-should-not-export');
      expect(JSON.parse(readFileSync(join(path, 'llm.json'), 'utf8')).apiKey).toBe(
        'xai-test-key-should-not-export',
      );
    } finally {
      await runtime.app.close();
      remove();
    }
  });
  it('returns field paths from the extension route without the API key', async () => {
    const { store, path, remove } = temporaryStore();
    writeLlmKey(path, 'xai-test-key-should-not-export');
    const bridge = createEdgeBridge(store, process.cwd(), 'test-extension', async () => mapped);
    await bridge.app.ready();
    try {
      const headers = { host: '127.0.0.1:3182', origin: 'chrome-extension://test-extension' };
      const pair = await bridge.app.inject({
        method: 'POST',
        url: '/extension/pair',
        headers,
        payload: { extensionId: 'test-extension', code: bridge.setup().pairCode },
      });
      const response = await bridge.app.inject({
        method: 'POST',
        url: '/extension/field-map',
        headers: { ...headers, authorization: `Bearer ${pair.json().token}` },
        payload: { origin: 'https://career.example.com', shapes, samples },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().map.appliedAt).toBe('applyTime');
      expect(JSON.stringify(response.json())).not.toContain('xai-test-key-should-not-export');
    } finally {
      await bridge.app.close();
      remove();
    }
  });
});
