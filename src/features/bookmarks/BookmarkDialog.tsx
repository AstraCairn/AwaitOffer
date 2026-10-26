import { useEffect, useState } from 'react';
import { ArrowDownToLine, FolderOpen, LoaderCircle } from 'lucide-react';
import type { Bookmark, BookmarkFolder } from '../../../shared/model';
import { api } from '../../lib/api';
import { platformLabels } from '../../lib/format';
import { Dialog } from '../../components/Dialog';
import { CompanyMark } from '../../components/CompanyMark';

export function BookmarkDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (count: number) => Promise<void>;
}) {
  const [folders, setFolders] = useState<BookmarkFolder[] | null>(null);
  const [folderId, setFolderId] = useState('');
  const [items, setItems] = useState<Bookmark[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void api<BookmarkFolder[]>('/bookmarks/folders')
      .then((next) => {
        if (cancelled) return;
        setFolders(next);
        setFolderId(next.find((folder) => folder.name === '秋招岗位')?.id ?? '');
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setSelected(new Set());
    setError('');
    if (folderId)
      void api<Bookmark[]>(`/bookmarks?folderId=${encodeURIComponent(folderId)}`)
        .then((next) => {
          if (cancelled) return;
          setItems(next);
          setSelected(new Set(next.slice(0, 500).map((item) => item.url)));
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [folderId]);
  return (
    <Dialog
      title="导入书签"
      subtitle="从 Edge 默认配置中选择一个文件夹，预览后再导入"
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        <div className="info-box">
          <FolderOpen size={18} />
          <span>
            仅导入公司与官网入口，先保存为手动记录。不会自动登录，重复入口会跳过；也可以稍后开启同步。
          </span>
        </div>
        <label className="field">
          书签文件夹
          <select
            aria-label="书签文件夹"
            value={folderId}
            disabled={!folders || busy}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">请选择文件夹</option>
            {folders?.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}（{folder.count} 个入口）
              </option>
            ))}
          </select>
        </label>
        {!folders && !error && (
          <p className="loading-line">
            <LoaderCircle className="spin" size={18} />
            正在读取文件夹…
          </p>
        )}
        {folders?.length === 0 && (
          <p className="muted">还没有书签文件夹。可以先在 Edge 中整理书签，或直接手动添加投递。</p>
        )}
        {folderId && !items && !error && (
          <p className="loading-line">
            <LoaderCircle className="spin" size={18} />
            正在预览入口…
          </p>
        )}
        {items && (
          <>
            {items.length > 0 ? (
              <>
                <label className="select-all">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.size === Math.min(items.length, 500)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(items.slice(0, 500).map((i) => i.url))
                          : new Set(),
                      )
                    }
                  />
                  选择前 {Math.min(items.length, 500)} 个入口 <span>已选 {selected.size}</span>
                </label>
                <div className="bookmark-list">
                  {items.map((item) => (
                    <label className="bookmark-item" key={item.url}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.url)}
                        disabled={busy || (!selected.has(item.url) && selected.size >= 500)}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            e.target.checked ? next.add(item.url) : next.delete(item.url);
                            return next;
                          })
                        }
                      />
                      <CompanyMark company={item.company} />
                      <div>
                        <strong>{item.company}</strong>
                        <small>{new URL(item.url).hostname}</small>
                      </div>
                      <span className="platform-chip">{platformLabels[item.platform]}</span>
                    </label>
                  ))}
                </div>
                {items.length > 500 && (
                  <p className="muted">每次最多导入 500 个入口，可分次导入。</p>
                )}
              </>
            ) : (
              <p className="empty-inline">这个文件夹没有有效的 HTTP/HTTPS 入口，试试其他文件夹。</p>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={busy || !items || !selected.size}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await api<{ imported: number }>('/bookmarks/import', 'POST', {
                folderId,
                urls: [...selected],
              });
              await onImported(result.imported);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}导入{' '}
          {selected.size} 个入口
        </button>
      </div>
    </Dialog>
  );
}
