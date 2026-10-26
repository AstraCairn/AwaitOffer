import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { backupSchema, type Application, type Settings } from '../shared/model';
import { useDashboard } from './hooks/useDashboard';
import { useEdgeConnection } from './hooks/useEdgeConnection';
import { api } from './lib/api';
import { date, intervalLabel } from './lib/format';
import { Dialog } from './components/Dialog';
import { ApplicationForm } from './features/applications/ApplicationForm';
import { HistoryDialog } from './features/applications/HistoryDialog';
import {
  ApplicationsPanel,
  emptyFilters,
  type ApplicationActions,
  type Filters,
} from './features/applications/ApplicationsPanel';
import { summary, type Filter } from './features/applications/selectors';
import { BookmarkDialog } from './features/bookmarks/BookmarkDialog';
import { BrowserDialog } from './features/connections/BrowserDialog';
import { ConnectionDialog } from './features/connections/ConnectionDialog';
import { ConnectionsPage } from './features/connections/ConnectionsPage';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { WelcomeGuide } from './features/onboarding/WelcomeGuide';

type Modal =
  | { type: 'form'; app?: Application }
  | { type: 'history' | 'connect' | 'delete'; id: string }
  | { type: 'bookmarks' | 'settings' | 'browser' }
  | { type: 'restore'; backup: unknown; name: string; count: number }
  | null;
const guideKey = 'awaitoffer-guide-v1';
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing still works. */
  }
}

export default function App() {
  const { data, offline, busy, notice, setNotice, load, act } = useDashboard();
  const edge = useEdgeConnection();
  const [page, setPage] = useState<'applications' | 'connections'>('applications');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [view, setView] = useState<'list' | 'board'>(() =>
    stored('awaitoffer-view') === 'board' ? 'board' : 'list',
  );
  const [modal, setModal] = useState<Modal>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showGuide, setShowGuide] = useState<boolean | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setModal(null), []);
  const counts = summary(data);
  const run = data?.activeRun;
  const latest = data?.latestRun;
  const selected =
    modal && 'id' in modal ? data?.applications.find((a) => a.id === modal.id) : undefined;
  const canSync = !!edge.setup?.connected && !offline;
  const autoCount = data?.applications.filter((a) => a.mode === 'auto').length ?? 0;
  const syncDisabled = busy || !!run || !canSync || !autoCount;
  const syncReason = offline
    ? '本地服务未连接'
    : !canSync
      ? '请先连接 Edge 浏览器'
      : !autoCount
        ? '添加自动投递或在官网连接中开启同步'
        : run
          ? '正在同步，请稍候'
          : '';
  useEffect(() => {
    if (data && showGuide === null)
      setShowGuide(data.applications.length === 0 && stored(guideKey) !== 'done');
  }, [data, showGuide]);
  useEffect(() => {
    persist('awaitoffer-view', view);
  }, [view]);
  const finishGuide = () => {
    persist(guideKey, 'done');
    setShowGuide(false);
  };
  const go = (next: 'applications' | 'connections', filter: Filter = 'all') => {
    setPage(next);
    setFilters({ ...emptyFilters, filter });
    setMobileMenu(false);
  };
  const saveSettings = async (value: Omit<Settings, 'nextRefreshAt'>) => {
    await api('/settings', 'PUT', value);
    await load();
  };
  const actions: ApplicationActions = {
    history: (app) => setModal({ type: 'history', id: app.id }),
    connect: (app) => setModal(canSync ? { type: 'connect', id: app.id } : { type: 'browser' }),
    edit: (app) => setModal({ type: 'form', app }),
    remove: (app) => setModal({ type: 'delete', id: app.id }),
    refresh: (app) => {
      if (canSync) void act(() => api('/refresh', 'POST', { applicationId: app.id }));
    },
    read: (app) => {
      void act(() => api(`/applications/${app.id}/read`, 'POST'));
    },
  };
  const metricCards = [
    {
      label: '总投递',
      value: counts.total,
      filter: 'all',
      caption: '所有已记录的投递',
      icon: BriefcaseBusiness,
    },
    {
      label: '进行中',
      value: counts.active,
      filter: 'active',
      caption: '筛选、测评、面试与待定',
      icon: Clock3,
    },
    {
      label: '未读变化',
      value: counts.unread,
      filter: 'unread',
      caption: '等待你查看的新进展',
      icon: Sparkles,
    },
    {
      label: '已获结果',
      value: counts.resolved,
      filter: 'resolved',
      caption: '意向书与 Offer',
      icon: Trophy,
    },
  ] as const;
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="工作台侧栏">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go('applications');
          }}
        >
          <span className="brand-mark">
            A<span>·</span>
          </span>
          <span>
            AwaitOffer<small>等一个好消息</small>
          </span>
        </a>
        <div className="workspace-label">个人校招工作台</div>
        <nav aria-label="主导航">
          <button
            className={`nav-item ${page === 'applications' && filters.filter !== 'unread' ? 'active' : ''}`}
            onClick={() => go('applications')}
          >
            <LayoutDashboard size={18} />
            投递总览<span className="nav-count">{counts.total}</span>
          </button>
          <button
            className={`nav-item ${page === 'applications' && filters.filter === 'unread' ? 'active' : ''}`}
            onClick={() => go('applications', 'unread')}
          >
            <Bell size={18} />
            未读变化{counts.unread > 0 && <span className="nav-count accent">{counts.unread}</span>}
          </button>
          <button
            className={`nav-item ${page === 'connections' ? 'active' : ''}`}
            onClick={() => go('connections')}
          >
            <KeyRound size={18} />
            官网连接{counts.attention.length > 0 && <span className="attention-dot" />}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal({ type: 'settings' })}>
            <Settings2 size={18} />
            设置
          </button>
          <a className="nav-item" href="/api/backup" download>
            <ArrowDownToLine size={18} />
            导出备份
          </a>
          <div className="local-store">
            <ShieldCheck size={16} />
            <span>本地存储 · 无需注册</span>
          </div>
        </div>
      </aside>
      <main className="main-content" id="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的工作台</span>
            <span>/</span>
            <strong>
              {page === 'connections'
                ? '官网连接'
                : filters.filter === 'unread'
                  ? '未读变化'
                  : '投递总览'}
            </strong>
          </div>
          <button
            ref={menuButton}
            className="mobile-menu-button icon-button"
            aria-label="打开导航菜单"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={21} />
          </button>
          <span className="local-pill">
            <i className={`status-dot ${offline ? 'disconnected' : ''}`} />
            {offline ? '服务未连接' : '本地服务已连接'}
          </span>
        </header>
        <div className="page-content">
          {offline && (
            <div className="offline-banner" role="alert">
              <WifiOff size={18} />
              <span>
                无法连接本地服务，请确认 AwaitOffer 正在运行。
                {data ? '已加载的记录仍保留在页面上。' : ''}
              </span>
              <button className="text-button" onClick={() => void load()}>
                重试连接
              </button>
            </div>
          )}
          {!data ? (
            <div className="empty-state loading-state">
              {offline ? <WifiOff size={32} /> : <LoaderCircle className="spin" size={32} />}
              <h2>{offline ? '工作台暂时无法连接' : '正在打开你的工作台'}</h2>
              <p>{offline ? '请在项目目录运行启动脚本，然后重试。' : '正在读取本地记录…'}</p>
            </div>
          ) : showGuide ? (
            <WelcomeGuide
              settings={data.settings}
              hasApplications={!!counts.total}
              connected={!!edge.setup?.connected}
              onSave={saveSettings}
              onAdd={() => setModal({ type: 'form' })}
              onImport={() => setModal({ type: 'bookmarks' })}
              onConnect={() => setModal({ type: 'browser' })}
              onFinish={finishGuide}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="page-kicker">{data.settings.cohort} 届校招</div>
                  <h1>
                    {page === 'connections' ? '官网连接' : '投递工作台'}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {page === 'connections'
                      ? '把官网连接好，进度就能持续更新。'
                      : '把等待整理好，让每一次变化都不被错过。'}
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="button secondary"
                    disabled={syncDisabled}
                    title={syncReason || '检查所有自动投递的最新进度'}
                    onClick={() => void act(() => api('/refresh', 'POST', {}))}
                  >
                    <RefreshCw size={16} className={run ? 'spin' : ''} />
                    {run ? '同步中' : '同步进度'}
                  </button>
                  <button className="button primary" onClick={() => setModal({ type: 'form' })}>
                    <Plus size={17} />
                    新增投递
                  </button>
                </div>
              </div>
              {page === 'applications' && (
                <div className="metrics" aria-label="投递概览">
                  {metricCards.map((card) => (
                    <button
                      key={card.filter}
                      className={`metric-card ${filters.filter === card.filter ? 'selected' : ''} ${card.filter === 'unread' && counts.unread ? 'has-updates' : ''}`}
                      aria-pressed={filters.filter === card.filter}
                      onClick={() => setFilters({ ...emptyFilters, filter: card.filter })}
                    >
                      <div className="metric-top">
                        <span>{card.label}</span>
                        <card.icon size={18} />
                      </div>
                      <div className="metric-number">
                        {card.value}
                        <span>份</span>
                      </div>
                      <p>{card.caption}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className="sync-strip">
                <span>
                  <i className={`status-dot ${canSync ? '' : 'disconnected'}`} />
                  <button className="text-button" onClick={() => setModal({ type: 'browser' })}>
                    {canSync
                      ? 'Edge 已连接'
                      : edge.checked
                        ? '连接 Edge 以开启同步'
                        : '正在检查浏览器连接'}
                  </button>
                </span>
                <span className="sync-divider" />
                <span>
                  <Clock3 size={14} />
                  {data.settings.enabled
                    ? intervalLabel(data.settings.intervalMinutes)
                    : '定时同步已暂停'}
                </span>
                <span className="sync-last">
                  {latest
                    ? `最近同步 ${date(latest.finishedAt || latest.startedAt)}`
                    : '尚未执行同步'}
                </span>
                <button
                  className="icon-button"
                  aria-label="同步设置"
                  onClick={() => setModal({ type: 'settings' })}
                >
                  <Settings2 size={15} />
                </button>
              </div>
              {!canSync && autoCount > 0 && (
                <p className="sync-explanation">
                  同步暂不可用：请先连接 Edge 浏览器。手动记录仍可使用。
                </p>
              )}
              {counts.attention.length > 0 && (
                <details className="attention-panel">
                  <summary>
                    <span>
                      <KeyRound size={16} />
                      <strong>{counts.attention.length} 家公司的连接需要处理</strong>
                      <span className="attention-summary">登录、验证或读取异常</span>
                    </span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="attention-content">
                    {counts.attention.map((app) => (
                      <div className="attention-item" key={app.connectionId ?? app.id}>
                        <strong>{app.company}</strong>
                        <span>{app.checkMessage || '尚未完成首次读取'}</span>
                        <button
                          className="button secondary small"
                          disabled={busy || !!run}
                          onClick={() => actions.connect(app)}
                        >
                          {app.checkState === 'expired'
                            ? '去登录'
                            : app.checkState === 'challenge'
                              ? '去验证'
                              : '检查连接'}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {data.onboarding.active && (
                <div className="onboarding-banner" role="status">
                  <LoaderCircle className="spin" size={18} />
                  <div>
                    <strong>
                      正在连接{' '}
                      {data.connections.find((c) => c.id === data.onboarding.currentId)?.name}
                    </strong>
                    <p>{data.onboarding.message}</p>
                    <small>剩余 {data.onboarding.queue.length} 家</small>
                  </div>
                  <div className="connection-buttons">
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void act(() => api('/onboarding/check', 'POST'))}
                    >
                      立即检查
                    </button>
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void act(() => api('/onboarding/skip', 'POST'))}
                    >
                      跳过
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void act(() => api('/onboarding/cancel', 'POST'))}
                    >
                      暂停
                    </button>
                  </div>
                </div>
              )}
              {run && (
                <div className="run-banner" role="status">
                  <LoaderCircle className="spin" size={17} />
                  <span>
                    正在检查 {Object.keys(run.outcomes).length} / {run.applicationIds.length} 条投递
                  </span>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${run.applicationIds.length ? (Object.keys(run.outcomes).length / run.applicationIds.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span>{run.changedIds.length} 条变化</span>
                </div>
              )}
              {page === 'applications' ? (
                <ApplicationsPanel
                  data={data}
                  filters={filters}
                  setFilters={setFilters}
                  view={view}
                  setView={setView}
                  busy={busy || !!run || offline}
                  canSync={canSync}
                  onAdd={() => setModal({ type: 'form' })}
                  onImport={() => setModal({ type: 'bookmarks' })}
                  onReadAll={() =>
                    void act(() => api('/applications/read-all', 'POST'), '已全部标为已读')
                  }
                  actions={actions}
                />
              ) : (
                <ConnectionsPage
                  data={data}
                  setup={edge.setup}
                  busy={busy || !!run || offline}
                  onBrowser={() => setModal({ type: 'browser' })}
                  onConnect={actions.connect}
                  onStart={() => void act(() => api('/onboarding/start', 'POST', {}))}
                  onImport={() => setModal({ type: 'bookmarks' })}
                  onRestoreIgnored={(connectionId, externalId) =>
                    void act(
                      () => api('/ignored/restore', 'POST', { connectionId, externalId }),
                      '已恢复，下次同步时重新导入',
                    )
                  }
                />
              )}
              {latest && (
                <p className="refresh-summary">
                  最近一次同步：
                  {
                    Object.values(latest.outcomes).filter((v) => ['ok', 'changed'].includes(v))
                      .length
                  }{' '}
                  条成功，{latest.changedIds.length} 条变化，
                  {
                    Object.values(latest.outcomes).filter((v) =>
                      ['expired', 'challenge', 'error', 'unmatched'].includes(v),
                    ).length
                  }{' '}
                  条需处理。首次读取建立基线。
                </p>
              )}
              <footer className="page-footer">
                <span>
                  AwaitOffer <span>/</span> 等一个好消息
                </span>
                <span>你的投递，由你掌握</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {notice && (
        <div className={`toast ${notice.error ? 'error' : ''}`} role="status">
          {notice.error ? <XCircle size={18} /> : <Check size={18} />}
          <span>{notice.message}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      <input
        ref={restoreInput}
        type="file"
        accept=".json,application/json"
        aria-label="选择备份文件"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            if (file.size > 16 * 1024 * 1024) throw new Error('备份超过 16 MB，无法导入。');
            let value: unknown;
            try {
              value = JSON.parse(await file.text());
            } catch {
              throw new Error('无法读取 JSON，请选择有效的 AwaitOffer 备份文件。');
            }
            const result = backupSchema.safeParse(value);
            if (!result.success) throw new Error('请选择完整的 AwaitOffer v1 或 v2 JSON 备份。');
            setModal({
              type: 'restore',
              backup: result.data,
              name: file.name,
              count: result.data.applications.length,
            });
          } catch (error) {
            setNotice({ message: (error as Error).message, error: true });
          }
        }}
      />
      {mobileMenu && (
        <Dialog
          title="导航菜单"
          onClose={() => {
            setMobileMenu(false);
            menuButton.current?.focus();
          }}
        >
          <nav className="mobile-navigation" aria-label="移动导航">
            <button onClick={() => go('applications')}>
              <LayoutDashboard size={18} />
              投递总览
            </button>
            <button onClick={() => go('applications', 'unread')}>
              <Bell size={18} />
              未读变化
            </button>
            <button onClick={() => go('connections')}>
              <KeyRound size={18} />
              官网连接
            </button>
            <button
              onClick={() => {
                setMobileMenu(false);
                setModal({ type: 'settings' });
              }}
            >
              <Settings2 size={18} />
              设置
            </button>
            <button
              onClick={() => {
                setMobileMenu(false);
                setModal({ type: 'bookmarks' });
              }}
            >
              <FolderOpen size={18} />
              导入书签
            </button>
            <a href="/api/backup" download>
              <ArrowDownToLine size={18} />
              导出备份
            </a>
          </nav>
        </Dialog>
      )}
      {modal?.type === 'form' && (
        <ApplicationForm
          app={modal.app}
          onClose={close}
          onSave={async (input) => {
            const app = await api<Application>(
              modal.app ? `/applications/${modal.app.id}` : '/applications',
              modal.app ? 'PUT' : 'POST',
              input,
            );
            await load();
            setNotice({ message: modal.app ? '投递记录已保存' : '投递已记下' });
            setModal(
              app.mode === 'auto' && !app.externalId
                ? canSync
                  ? { type: 'connect', id: app.id }
                  : { type: 'browser' }
                : null,
            );
          }}
        />
      )}
      {modal?.type === 'history' && selected && (
        <HistoryDialog app={selected} onClose={close} onRead={() => actions.read(selected)} />
      )}
      {modal?.type === 'connect' && selected && (
        <ConnectionDialog app={selected} active={!!run} onClose={close} onChange={load} />
      )}
      {modal?.type === 'bookmarks' && (
        <BookmarkDialog
          onClose={close}
          onImported={async (count) => {
            await load();
            close();
            setNotice({ message: `已导入 ${count} 个公司入口，可补充岗位或连接官网。` });
          }}
        />
      )}
      {modal?.type === 'browser' && (
        <BrowserDialog
          setup={edge.setup}
          canRefresh={autoCount > 0}
          onCheck={edge.load}
          onClose={close}
          onChange={load}
        />
      )}
      {modal?.type === 'settings' && data && (
        <SettingsDialog
          settings={data.settings}
          onClose={close}
          onSave={async (value) => {
            await saveSettings(value);
            setNotice({ message: '同步设置已保存' });
          }}
          onNotice={(message, error) => setNotice({ message, error })}
          onRestore={() => restoreInput.current?.click()}
          onGuide={() => {
            close();
            setShowGuide(true);
          }}
        />
      )}
      {modal?.type === 'delete' && selected && (
        <Dialog
          title="删除这条投递？"
          subtitle={`${selected.company} · ${selected.position}`}
          onClose={close}
        >
          <div className="dialog-body">
            <p>
              这条记录和历史时间轴将一起删除。自动投递会同时加入忽略列表，避免下次同步重新导入。
            </p>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={close}>
              取消
            </button>
            <button
              className="button danger"
              disabled={busy || !!run}
              onClick={() =>
                void act(async () => {
                  await api(`/applications/${selected.id}`, 'DELETE');
                  close();
                }, '记录已删除')
              }
            >
              确认删除
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'restore' && (
        <Dialog title="恢复本地备份" subtitle={modal.name} onClose={close}>
          <div className="dialog-body">
            <p>
              将用备份中的 <strong>{modal.count}</strong> 条投递替换当前数据。
            </p>
            <div className="info-box">
              恢复前自动备份当前数据。备份不含官网登录状态、配对令牌和 AI
              密钥；恢复后需重新验证官网连接。
            </div>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={close}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || !!run}
              onClick={() =>
                void act(async () => {
                  await api('/restore', 'POST', modal.backup);
                  close();
                }, '备份已恢复，原数据已保存到本地 backups 目录。')
              }
            >
              恢复备份
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
