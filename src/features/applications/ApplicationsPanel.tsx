import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Clock3,
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  hasUnread,
  stageLabels,
  stages,
  type Application,
  type Dashboard,
} from '../../../shared/model';
import { days, platformLabels } from '../../lib/format';
import { CompanyMark } from '../../components/CompanyMark';
import { ApplicationRow, Status } from './ApplicationRow';
import { selectApplications, type Filter } from './selectors';

export interface ApplicationActions {
  history: (app: Application) => void;
  connect: (app: Application) => void;
  edit: (app: Application) => void;
  remove: (app: Application) => void;
  refresh: (app: Application) => void;
  read: (app: Application) => void;
}
export interface Filters {
  filter: Filter;
  query: string;
  stage: string;
  platform: string;
  progress: string;
}
export const emptyFilters: Filters = {
  filter: 'all',
  query: '',
  stage: 'all',
  platform: 'all',
  progress: 'all',
};
export function ApplicationsPanel({
  data,
  filters,
  setFilters,
  view,
  setView,
  busy,
  canSync,
  onAdd,
  onImport,
  onReadAll,
  actions,
}: {
  data: Dashboard;
  filters: Filters;
  setFilters: (next: Filters) => void;
  view: 'list' | 'board';
  setView: (next: 'list' | 'board') => void;
  busy: boolean;
  canSync: boolean;
  onAdd: () => void;
  onImport: () => void;
  onReadAll: () => void;
  actions: ApplicationActions;
}) {
  const { visible, choices } = selectApplications(data, filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const advancedCount = [filters.stage, filters.platform, filters.progress].filter(
    (value) => value !== 'all',
  ).length;
  const update = (next: Partial<Filters>) => setFilters({ ...filters, ...next });
  const unread = data.applications.filter(hasUnread).length;
  return (
    <section className="applications-section" aria-label="投递记录">
      <div className="section-heading">
        <div>
          <h2>
            {filters.filter === 'unread' ? '未读变化' : '我的投递'}
            <span className="section-count">{visible.length}</span>
          </h2>
          <p>每一步进展，都有记录。</p>
        </div>
        <div className="section-actions">
          <button
            className="button secondary small mobile-filter-button"
            aria-label="展开或收起筛选"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            筛选{advancedCount > 0 ? ` · ${advancedCount}` : ''}
          </button>
          <button className="button secondary small import-button" onClick={onImport}>
            <FolderOpen size={15} />
            导入书签
          </button>
          <div className="view-toggle" role="group" aria-label="视图">
            <button
              aria-label="列表视图"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'selected' : ''}
              onClick={() => setView('list')}
            >
              <List size={17} />
            </button>
            <button
              aria-label="看板视图"
              aria-pressed={view === 'board'}
              className={view === 'board' ? 'selected' : ''}
              onClick={() => setView('board')}
            >
              <LayoutGrid size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="filter-bar">
        <div className="filter-tabs" role="group" aria-label="投递范围">
          {(
            [
              ['all', '全部投递'],
              ['unread', '未读变化'],
              ['updated', '本次变动'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={filters.filter === value ? 'active' : ''}
              aria-pressed={filters.filter === value}
              onClick={() => update({ filter: value, progress: 'all' })}
            >
              {label}
              {value === 'unread' && unread > 0 && <span>{unread}</span>}
            </button>
          ))}
        </div>
        {unread > 0 && (
          <button className="text-button" disabled={busy} onClick={onReadAll}>
            <CheckCheck size={15} />
            全部已读
          </button>
        )}
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索公司或岗位"
            placeholder="搜索公司或岗位…"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value, progress: 'all' })}
          />
          {filters.query && (
            <button aria-label="清空搜索" onClick={() => update({ query: '' })}>
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      <div className={`filter-selects ${filtersOpen ? 'filters-open' : ''}`}>
        <label>
          阶段
          <select
            aria-label="筛选招聘阶段"
            value={filters.stage}
            onChange={(e) => update({ stage: e.target.value, progress: 'all' })}
          >
            <option value="all">全部阶段</option>
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabels[stage]}
              </option>
            ))}
          </select>
        </label>
        <label>
          系统
          <select
            aria-label="筛选招聘系统"
            value={filters.platform}
            onChange={(e) => update({ platform: e.target.value, progress: 'all' })}
          >
            <option value="all">全部系统</option>
            {Object.entries(platformLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          原始状态
          <select
            aria-label="筛选原始状态"
            value={filters.progress}
            onChange={(e) => update({ progress: e.target.value })}
          >
            <option value="all">全部原始状态</option>
            {choices.map((choice) => (
              <option value={choice} key={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
        {(filters.filter !== 'all' ||
          filters.query ||
          filters.stage !== 'all' ||
          filters.platform !== 'all' ||
          filters.progress !== 'all') && (
          <button className="text-button" onClick={() => setFilters(emptyFilters)}>
            重置筛选
            <X size={13} />
          </button>
        )}
        <span className="result-count">共 {visible.length} 条</span>
      </div>
      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-illustration">
            <FolderOpen size={32} />
          </div>
          <h3>{data.applications.length ? '没有符合条件的投递' : '从第一条投递开始'}</h3>
          <p>
            {data.applications.length
              ? '调整筛选条件，或搜索其他公司与岗位。'
              : '手动记下投递，或从书签批量导入公司入口。'}
          </p>
          <button
            className="button primary"
            onClick={data.applications.length ? () => setFilters(emptyFilters) : onAdd}
          >
            {data.applications.length ? (
              '清除筛选'
            ) : (
              <>
                <Plus size={16} />
                添加第一条投递
              </>
            )}
          </button>
        </div>
      ) : view === 'list' ? (
        <div className="table-scroll">
          <table className="applications-table">
            <thead>
              <tr>
                <th>公司 / 岗位</th>
                <th>当前进度</th>
                <th>状态停留</th>
                <th>最近检查</th>
                <th className="actions-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  change={data.latestChanges[app.id]}
                  busy={busy || (app.mode === 'auto' && !canSync)}
                  onHistory={() => actions.history(app)}
                  onConnect={() => actions.connect(app)}
                  onEdit={() => actions.edit(app)}
                  onDelete={() => actions.remove(app)}
                  onRefresh={() => actions.refresh(app)}
                  onRead={() => actions.read(app)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="board">
          {stages
            .filter((stage) => visible.some((app) => app.stage === stage))
            .map((stage) => (
              <section className="board-column" key={stage}>
                <div className={`column-heading stage-${stage}`}>
                  <i />
                  <h3>{stageLabels[stage]}</h3>
                  <span>{visible.filter((a) => a.stage === stage).length}</span>
                </div>
                {visible
                  .filter((a) => a.stage === stage)
                  .map((app) => (
                    <article
                      className={`board-card ${hasUnread(app) ? 'unread' : ''}`}
                      key={app.id}
                    >
                      <button className="board-card-title" onClick={() => actions.history(app)}>
                        <CompanyMark company={app.company} />
                        <strong>{app.company}</strong>
                        <ArrowUpRight size={15} />
                      </button>
                      <p className="board-position">{app.position}</p>
                      <Status app={app} onConnect={() => actions.connect(app)} />
                      {hasUnread(app) && data.latestChanges[app.id] && (
                        <button className="board-change" onClick={() => actions.history(app)}>
                          <Sparkles size={13} />
                          {data.latestChanges[app.id].fromStatus}
                          <ArrowRight size={13} />
                          {data.latestChanges[app.id].toStatus}
                        </button>
                      )}
                      <div className="board-meta">
                        <Clock3 size={13} />
                        {app.appliedAt || '投递时间未记录'}
                        <span>{days(app) === null ? '' : `${days(app)} 天`}</span>
                      </div>
                      <div className="board-card-footer">
                        <button aria-label={`编辑${app.company}`} onClick={() => actions.edit(app)}>
                          <Pencil size={15} />
                          编辑
                        </button>
                        <a
                          aria-label={`打开${app.company}官网`}
                          href={app.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={15} />
                        </a>
                        {app.mode === 'auto' && (
                          <button
                            aria-label={`刷新${app.company}`}
                            disabled={busy || !canSync}
                            onClick={() => actions.refresh(app)}
                          >
                            <RefreshCw size={15} />
                          </button>
                        )}
                        {hasUnread(app) && (
                          <button
                            aria-label={`标记${app.company}已读`}
                            disabled={busy}
                            onClick={() => actions.read(app)}
                          >
                            <CheckCheck size={15} />
                          </button>
                        )}
                        <button
                          aria-label={`删除${app.company}`}
                          disabled={busy}
                          onClick={() => actions.remove(app)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
              </section>
            ))}
        </div>
      )}
      <div className="table-footer">
        <span>招聘状态与官网原文分别保留</span>
        <span>时间以北京时间显示</span>
      </div>
    </section>
  );
}
