import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  Ellipsis,
  History as HistoryIcon,
  KeyRound,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  stageLabels,
  hasUnread,
  supportsAuto,
  type Application,
  type History,
} from '../../../shared/model';
import { date, days, platformLabels } from '../../lib/format';
import { CompanyMark } from '../../components/CompanyMark';
import { statusText } from './selectors';

export function Status({ app, onConnect }: { app: Application; onConnect: () => void }) {
  return (
    <div className="status-block">
      <div className="status-line">
        <span className={`stage-badge stage-${app.stage}`}>
          <i />
          {stageLabels[app.stage]}
        </span>
        {hasUnread(app) && <span className="new-badge">未读</span>}
      </div>
      <span className="raw-status">{statusText(app)}</span>
      {app.checkState === 'expired' ? (
        <button className="check-warning" title={app.checkMessage} onClick={onConnect}>
          <KeyRound size={12} />
          尚未登录 / 登录过期
          <ChevronRight size={12} />
        </button>
      ) : ['error', 'challenge', 'unmatched', 'connecting'].includes(app.checkState) ? (
        <button
          className={`check-note ${app.checkState === 'error' ? 'check-error' : ''}`}
          title={app.checkMessage}
          onClick={onConnect}
        >
          {app.checkState === 'challenge'
            ? '需要人工验证'
            : app.checkState === 'unmatched'
              ? '请选择官网投递'
              : app.checkState === 'connecting'
                ? '等待完成登录'
                : '查询失败，进度已保留'}
          <ChevronRight size={12} />
        </button>
      ) : app.mode === 'auto' && app.checkState === 'unknown' ? (
        <button className="check-note" onClick={onConnect}>
          尚未读取，去读取
          <ChevronRight size={12} />
        </button>
      ) : null}
    </div>
  );
}
export function ApplicationRow({
  app,
  change,
  busy,
  onHistory,
  onConnect,
  onEdit,
  onDelete,
  onRefresh,
  onRead,
}: {
  app: Application;
  change?: History;
  busy: boolean;
  onHistory: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onRead: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !menuPanel.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    const scroll = () => setMenu(false);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [menu]);
  return (
    <tr data-testid="application-row" className={hasUnread(app) ? 'unread-row' : ''}>
      <td data-label="公司 / 岗位">
        <button className="company-cell" onClick={onHistory}>
          <CompanyMark company={app.company} />
          <div>
            <strong>{app.company}</strong>
            <span>{app.position || '待确认岗位'}</span>
            <small>
              <span className="platform-chip">{platformLabels[app.platform]}</span>
              {app.mode === 'manual' && <span className="manual-tag">手动记录</span>}
              <span>{app.batch}</span>
              {app.appliedAt && <span>{app.appliedAt}</span>}
            </small>
          </div>
        </button>
        {hasUnread(app) && (
          <button className="change-hint" onClick={onHistory}>
            <Sparkles size={12} />
            {change?.fromStatus || '状态更新'}
            <ArrowRight size={12} />
            {change?.toStatus || '查看变更'}
          </button>
        )}
      </td>
      <td data-label="当前进度">
        <Status app={app} onConnect={onConnect} />
      </td>
      <td data-label="状态停留">
        <div className="duration">
          {days(app) === null ? (
            <span className="muted">—</span>
          ) : (
            <>
              <span>
                <strong>{days(app)}</strong> 天
              </span>
              <small>{app.sinceKnown ? '在当前状态' : '自首次记录起'}</small>
            </>
          )}
        </div>
      </td>
      <td data-label="最近检查">
        <span className="last-check">
          {app.mode === 'manual' ? '手动维护' : date(app.lastCheckedAt)}
        </span>
        {app.lastAttemptAt && (!app.lastCheckedAt || app.lastAttemptAt > app.lastCheckedAt) && (
          <small className="attempt-time">最近尝试 {date(app.lastAttemptAt)}</small>
        )}
      </td>
      <td data-label="操作">
        <div className="row-actions">
          <a
            className="icon-button"
            title={`打开${app.company}官网`}
            aria-label={`打开${app.company}官网`}
            href={app.url}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight size={17} />
          </a>
          {app.mode === 'auto' ? (
            <button
              className="icon-button"
              title={`刷新${app.company}`}
              aria-label={`刷新${app.company}`}
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={15} />
            </button>
          ) : (
            <button
              className="icon-button"
              title={`编辑${app.company}`}
              aria-label={`编辑${app.company}`}
              onClick={onEdit}
            >
              <Pencil size={15} />
            </button>
          )}
          <div className="menu-wrap" ref={menuRef}>
            <button
              className={`icon-button ${menu ? 'selected' : ''}`}
              title="更多操作"
              aria-label={`${app.company}更多操作`}
              aria-expanded={menu}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenuPosition({
                  top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 225)),
                  left: Math.max(12, rect.right - 168),
                });
                setMenu(!menu);
              }}
            >
              <Ellipsis size={18} />
            </button>
            {menu &&
              createPortal(
                <div
                  className="row-menu"
                  ref={menuPanel}
                  style={{ position: 'fixed', ...menuPosition, right: 'auto', zIndex: 70 }}
                >
                  <button
                    onClick={() => {
                      setMenu(false);
                      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                      onHistory();
                    }}
                  >
                    <HistoryIcon size={14} />
                    历史时间轴
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                      onEdit();
                    }}
                  >
                    <Pencil size={14} />
                    编辑投递
                  </button>
                  {(app.mode === 'auto' || supportsAuto(app.url)) && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                        onConnect();
                      }}
                    >
                      <KeyRound size={14} />
                      {app.mode === 'auto' ? '管理官网连接' : '开启自动查询'}
                    </button>
                  )}
                  {hasUnread(app) && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                        onRead();
                      }}
                    >
                      <CheckCheck size={14} />
                      标为已读
                    </button>
                  )}
                  <button
                    className="danger-text"
                    onClick={() => {
                      setMenu(false);
                      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
                      onDelete();
                    }}
                  >
                    <Trash2 size={14} />
                    删除投递
                  </button>
                </div>,
                document.body,
              )}
          </div>
        </div>
      </td>
    </tr>
  );
}
