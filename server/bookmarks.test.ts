import { describe, expect, it } from 'vitest';
import { listBookmarkFolders, parseBookmarks, type BookmarkTree } from './bookmarks.js';
import { createApp } from './app.js';
import { FakeBrowser, temporaryStore } from './test-utils.js';

function fixtureTree(): BookmarkTree {
  return {
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
                name: '星河科技',
                url: 'https://careers.example.com/applications?token=secret&tab=campus#/personal?session=secret&view=list',
              },
              {
                id: '3',
                type: 'folder',
                name: '研发',
                children: [
                  { type: 'url', name: '云帆实验室', url: 'https://cloud.example.com/apply' },
                ],
              },
              { type: 'url', name: '重复', url: 'https://cloud.example.com/apply' },
              { type: 'url', url: 'javascript:alert(1)' },
              { type: 'url', url: 'https://user:password@example.com/' },
            ],
          },
          {
            id: '4',
            type: 'folder',
            name: '研发',
            children: [
              { type: 'url', name: '远山智能', url: 'https://mountain.example.com/apply' },
            ],
          },
          { id: '5', type: 'folder', name: '空文件夹', children: [] },
        ],
      },
    },
  };
}
describe('bookmark folder selection', () => {
  it('reports paths for same-name folders and counts unique valid descendants', () => {
    const folders = listBookmarkFolders(fixtureTree());
    expect(folders.find((f) => f.id === 'edge:2')).toMatchObject({
      name: '秋招岗位',
      path: '收藏夹栏 / 秋招岗位',
      count: 2,
    });
    expect(folders.filter((f) => f.name === '研发').map((f) => f.path)).toEqual([
      '收藏夹栏 / 秋招岗位 / 研发',
      '收藏夹栏 / 研发',
    ]);
    expect(folders.find((f) => f.id === 'edge:1')?.count).toBe(3);
    expect(folders.find((f) => f.id === 'edge:5')?.count).toBe(0);
  });
  it('preserves legacy named-folder behavior and sanitizes navigation URLs', () => {
    const bookmarks = parseBookmarks(fixtureTree());
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0].url).toBe(
      'https://careers.example.com/applications?tab=campus#/personal?view=list',
    );
    expect(JSON.stringify(bookmarks)).not.toContain('secret');
  });
  it('limits explicit selection to its subtree and accepts an empty folder', () => {
    expect(parseBookmarks(fixtureTree(), 'edge:4').map((b) => b.company)).toEqual(['远山智能']);
    expect(parseBookmarks(fixtureTree(), 'edge:5')).toEqual([]);
    expect(parseBookmarks(fixtureTree(), 'edge:1')).toHaveLength(3);
  });
  it('rejects a removed folder and does not treat IDs as filesystem paths', () => {
    expect(() => parseBookmarks(fixtureTree(), 'edge:missing')).toThrow('重新选择');
    expect(() => parseBookmarks(fixtureTree(), '../../data')).toThrow('重新选择');
  });
  it('supports deterministic fallback IDs for fixtures without Edge IDs', () => {
    const tree: BookmarkTree = {
      roots: { bar: { children: [{ type: 'folder', name: '测试', children: [] }] } },
    };
    const folders = listBookmarkFolders(tree);
    expect(folders[1].id).toBe('path:bar/0');
    expect(parseBookmarks(tree, folders[1].id)).toEqual([]);
  });
});

describe('bookmark folder API with an injected reader', () => {
  async function fixture() {
    const { store, remove } = temporaryStore();
    store.saveSettings({
      enabled: false,
      intervalMinutes: 1440,
      cohort: 2027,
      nextRefreshAt: null,
    });
    let tree = fixtureTree();
    const runtime = createApp(store, new FakeBrowser(), async () => tree);
    await runtime.app.ready();
    return {
      ...runtime,
      store,
      remove,
      setTree: (next: BookmarkTree) => {
        tree = next;
      },
    };
  }
  it('lists folders, previews explicit selections and supports old callers', async () => {
    const f = await fixture();
    try {
      expect((await f.app.inject('/api/bookmarks/folders')).json()).toHaveLength(5);
      expect((await f.app.inject('/api/bookmarks?folderId=edge%3A4')).json()).toHaveLength(1);
      expect((await f.app.inject('/api/bookmarks')).json()).toHaveLength(2);
      const result = await f.app.inject({
        method: 'POST',
        url: '/api/bookmarks/import',
        payload: { urls: [parseBookmarks(fixtureTree())[0].url] },
      });
      expect(result.json()).toEqual({ imported: 1, skipped: 0 });
    } finally {
      await f.app.close();
      f.remove();
    }
  });
  it('rereads the chosen folder, ignores out-of-folder URLs and deduplicates imports', async () => {
    const f = await fixture();
    try {
      const payload = {
        folderId: 'edge:4',
        urls: ['https://mountain.example.com/apply', 'https://cloud.example.com/apply'],
      };
      expect(
        (await f.app.inject({ method: 'POST', url: '/api/bookmarks/import', payload })).json(),
      ).toEqual({ imported: 1, skipped: 0 });
      expect(f.store.applications().map((a) => a.company)).toEqual(['远山智能']);
      expect(
        (await f.app.inject({ method: 'POST', url: '/api/bookmarks/import', payload })).json(),
      ).toEqual({ imported: 0, skipped: 1 });
      f.setTree({ roots: {} });
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/bookmarks/import',
        payload,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('重新选择');
      expect(f.store.applications()).toHaveLength(1);
    } finally {
      await f.app.close();
      f.remove();
    }
  });
  it('returns an empty preview and rejects malformed query parameters', async () => {
    const f = await fixture();
    try {
      expect((await f.app.inject('/api/bookmarks?folderId=edge%3A5')).json()).toEqual([]);
      expect((await f.app.inject('/api/bookmarks?folderId=')).statusCode).toBe(400);
      expect((await f.app.inject('/api/bookmarks?file=D%3A%5Csecret')).statusCode).toBe(400);
    } finally {
      await f.app.close();
      f.remove();
    }
  });
});
