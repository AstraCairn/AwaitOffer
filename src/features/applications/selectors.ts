import { hasUnread, type Application, type Dashboard, type Stage } from '../../../shared/model';

export type Filter = 'all' | 'updated' | 'unread' | 'active' | Stage;
export function statusText(app: Application) {
  if (app.rawStatus) return app.rawStatus;
  if (app.checkState === 'ok' && app.checkMessage) return app.checkMessage;
  return app.mode === 'auto' ? '尚未获取进度' : '尚未记录进度';
}
export function isActive(app: Application) {
  return ['screening', 'assessment', 'interview', 'pool'].includes(app.stage);
}
export function summary(data: Dashboard | null) {
  const apps = data?.applications ?? [];
  return {
    total: apps.length,
    active: apps.filter(isActive).length,
    unread: apps.filter(hasUnread).length,
    resolved: apps.filter((a) => a.stage === 'resolved').length,
    attention: [
      ...new Map(
        apps
          .filter(
            (a) =>
              a.mode === 'auto' &&
              a.stage !== 'rejected' &&
              ['expired', 'challenge', 'error', 'unmatched', 'unknown'].includes(a.checkState),
          )
          .map((a) => [a.connectionId ?? a.id, a]),
      ).values(),
    ],
  };
}
export function selectApplications(
  data: Dashboard | null,
  options: { filter: Filter; stage: string; platform: string; query: string; progress: string },
) {
  const changed = new Set(data?.latestRun?.changedIds ?? []);
  const base = (data?.applications ?? []).filter((a) => {
    const matches =
      options.filter === 'all' ||
      (options.filter === 'unread' && hasUnread(a)) ||
      (options.filter === 'updated' && changed.has(a.id)) ||
      (options.filter === 'active' && isActive(a)) ||
      a.stage === options.filter;
    return (
      matches &&
      (options.stage === 'all' || a.stage === options.stage) &&
      (options.platform === 'all' || a.platform === options.platform) &&
      `${a.company} ${a.position}`.toLowerCase().includes(options.query.trim().toLowerCase())
    );
  });
  const choices = [...new Set(base.map(statusText))].sort((a, b) => a.localeCompare(b, 'zh'));
  return {
    choices,
    visible: base
      .filter((a) => options.progress === 'all' || statusText(a) === options.progress)
      .sort(
        (a, b) =>
          Number(hasUnread(b)) - Number(hasUnread(a)) || b.updatedAt.localeCompare(a.updatedAt),
      ),
  };
}
