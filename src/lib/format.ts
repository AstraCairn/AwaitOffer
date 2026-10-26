import type { Application } from '../../shared/model';
export const platformLabels = {
  feishu: '飞书招聘',
  moka: 'Moka',
  beisen: '北森',
  custom: '自研 / 其他',
  manual: '手动',
};
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export function date(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : '尚未检查';
}
export function intervalLabel(minutes: number) {
  if (minutes % 60 === 0 && minutes >= 60) return `每 ${minutes / 60} 小时自动刷新`;
  return `每 ${minutes} 分钟自动刷新`;
}
export function days(app: Application) {
  return app.stateSince
    ? Math.max(0, Math.floor((Date.now() - new Date(app.stateSince).getTime()) / 86400000))
    : null;
}
