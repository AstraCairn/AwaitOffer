import { z } from 'zod';
export {
  careerSitePatterns,
  customSites,
  detectPlatform,
  matchHostPattern,
  supportsAuto,
  type CareerPlatform,
} from './sites.js';

export const stages = [
  'screening',
  'assessment',
  'interview',
  'pool',
  'resolved',
  'rejected',
  'unknown',
] as const;
export type Stage = (typeof stages)[number];
export const stageLabels: Record<Stage, string> = {
  screening: '简历筛选',
  assessment: '笔试测评',
  interview: '面试中',
  pool: '待定／候补',
  resolved: '已拿结果',
  rejected: '已结束',
  unknown: '待分类',
};
export const checkStates = [
  'unknown',
  'ok',
  'expired',
  'challenge',
  'error',
  'unmatched',
  'connecting',
] as const;
const timestamp = z.iso.datetime();
export function sanitizeRecruitmentUrl(value: string): string {
  const url = new URL(value);
  const sensitive =
    /token|authorization|password|secret|session|credential|ticket|auth_code|^code$|signature|^sig$|^candidate|^recommendcode$|^utm_/i;
  for (const key of [...url.searchParams.keys()])
    if (sensitive.test(key)) url.searchParams.delete(key);
  const fragment = url.hash.slice(1);
  if (fragment && !fragment.startsWith('/')) {
    if (sensitive.test(fragment.split('=')[0])) url.hash = '';
  } else if (fragment.includes('?')) {
    const [route, query] = [
      fragment.slice(0, fragment.indexOf('?')),
      fragment.slice(fragment.indexOf('?') + 1),
    ];
    const params = new URLSearchParams(query);
    for (const key of [...params.keys()]) if (sensitive.test(key)) params.delete(key);
    url.hash = route + (params.size ? `?${params}` : '');
  }
  rewriteMokaThanks(url);
  return url.toString();
}
function rewriteMokaThanks(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host !== 'mokahr.com' && !host.endsWith('.mokahr.com')) return;
  const raw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const route = raw.split('?')[0];
  if (/\/campus_apply\/thanks\/?$/.test(route) || /\/job\/[^/]+\/.*\/thanks\/?$/.test(route))
    url.hash = '#/candidateHome/applications';
}
export const websiteUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  }, '请输入不包含账号密码的 HTTP/HTTPS 官网链接')
  .transform(sanitizeRecruitmentUrl);
const text = z.string().trim().min(1).max(200);
const appliedAtFields = [
  'deliverTime',
  'deliveryTime',
  'deliverDate',
  'deliveryDate',
  'DeliveryDate',
  'applyTime',
  'applyDate',
  'appliedAt',
  'apply_time',
  'deliver_time',
  'create_time',
  'createTime',
  'biz_create_time',
  'submitDate',
  'submitTime',
  'postTime',
  'applicationTime',
];
/** A site delivery clock, kept as a Shanghai calendar time. Midnight keeps the date only. */
export function normalizeAppliedAt(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{10,13}$/.test(value.trim()))
    return normalizeAppliedAt(Number(value.trim()));
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const year = Number(get('year'));
    if (year < 2020 || year > 2100) return null;
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    const time = `${get('hour')}:${get('minute')}`;
    return time === '00:00' ? day : `${day} ${time}`;
  }
  if (typeof value !== 'string') return null;
  const textValue = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(textValue)) {
    const parsed = Date.parse(textValue);
    if (!Number.isNaN(parsed)) return normalizeAppliedAt(parsed);
  }
  const match = textValue.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  if (!match[4] || (match[4] === '00' && match[5] === '00')) return day;
  return `${day} ${match[4].padStart(2, '0')}:${match[5]}`;
}
export function appliedAtFromRow(row: Record<string, unknown>) {
  for (const key of appliedAtFields) {
    if (!(key in row)) continue;
    const appliedAt = normalizeAppliedAt(row[key]);
    if (appliedAt) return appliedAt;
  }
  return null;
}
export function mokaAppliedAt(externalId: string | null | undefined) {
  if (!externalId?.startsWith('moka-delivery:')) return null;
  try {
    const parsed = JSON.parse(externalId.slice('moka-delivery:'.length)) as unknown;
    return Array.isArray(parsed) ? normalizeAppliedAt(parsed[1]) : null;
  } catch {
    return null;
  }
}
export const applicationInputSchema = z
  .object({
    company: text,
    position: z.string().trim().max(200).default('待确认岗位'),
    batch: z.string().trim().max(100).default('秋招正式批'),
    url: websiteUrl,
    mode: z.enum(['auto', 'manual']),
    platform: z.enum(['feishu', 'moka', 'beisen', 'custom', 'manual']).default('manual'),
    rawStatus: z.string().trim().max(200).default(''),
    appliedAt: z
      .union([z.string().trim().max(40), z.null()])
      .nullish()
      .transform((value) => normalizeAppliedAt(value)),
    stageOverride: z.enum(stages).nullable().default(null),
  })
  .strict();
export type ApplicationInput = z.infer<typeof applicationInputSchema>;
export const applicationSchema = applicationInputSchema
  .extend({
    id: z.uuid(),
    connectionId: z.uuid().nullable(),
    externalId: z.string().max(512).nullable(),
    stage: z.enum(stages),
    stateSince: timestamp.nullable(),
    sinceKnown: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAttemptAt: timestamp.nullable(),
    lastCheckedAt: timestamp.nullable(),
    checkState: z.enum(checkStates),
    checkMessage: z.string().max(1000),
    lastChangeId: z.uuid().nullable(),
    lastReadChangeId: z.uuid().nullable(),
  })
  .strict();
export type Application = z.infer<typeof applicationSchema>;
export const historySchema = z
  .object({
    id: z.uuid(),
    applicationId: z.uuid(),
    fromStatus: z.string().max(200).nullable(),
    toStatus: z.string().max(200),
    at: timestamp,
    source: z.enum(['initial', 'auto', 'manual']),
  })
  .strict();
export type History = z.infer<typeof historySchema>;
export const connectionSchema = z
  .object({
    id: z.uuid(),
    origin: z.string().url(),
    url: websiteUrl,
    platform: z.enum(['feishu', 'moka', 'beisen', 'custom']),
    adapterId: z.string().max(100).optional(),
    transport: z.enum(['dedicated', 'edge']).optional(),
    pauseReason: z.enum(['expired', 'challenge']).nullable().optional(),
    name: text,
    createdAt: timestamp,
    verifiedAt: timestamp.nullable(),
  })
  .strict();
export type Connection = z.infer<typeof connectionSchema>;
export const runSchema = z
  .object({
    id: z.uuid(),
    startedAt: timestamp,
    finishedAt: timestamp.nullable(),
    state: z.enum(['running', 'completed', 'interrupted']),
    source: z.enum(['manual', 'scheduled']).optional(),
    scope: z.enum(['all', 'single', 'selected']).optional(),
    importedIds: z.array(z.uuid()).optional(),
    queuedFull: z.boolean().optional(),
    applicationIds: z.array(z.uuid()),
    changedIds: z.array(z.uuid()),
    outcomes: z.record(
      z.string(),
      z.enum(['ok', 'changed', 'expired', 'challenge', 'error', 'unmatched', 'skipped']),
    ),
  })
  .strict();
export type RefreshRun = z.infer<typeof runSchema>;
export const settingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().int().min(5).max(10080).default(1440),
    cohort: z.number().int().min(2020).max(2100).default(2027),
    nextRefreshAt: timestamp.nullable().default(null),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const ignoredSchema = z.object({
  connectionId: z.uuid(),
  externalId: z.string().min(1).max(512),
  position: z.string().max(200),
});
export type IgnoredApplication = z.infer<typeof ignoredSchema>;
export const backupSchema = z
  .object({
    format: z.literal('AwaitOffer'),
    version: z.union([z.literal(1), z.literal(2)]),
    settings: settingsSchema.optional(),
    ignored: z.array(ignoredSchema).max(10000).optional(),
    exportedAt: timestamp,
    applications: z.array(applicationSchema).max(10000),
    history: z.array(historySchema).max(200000),
    connections: z.array(connectionSchema).max(10000),
    runs: z.array(runSchema).max(10000),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;
export interface RemoteApplication {
  recruitmentType?: string;
  id: string;
  position: string;
  batch: string;
  rawStatus: string;
  appliedAt?: string;
}
/** Same rule import uses: drop internships and social hiring; a stated year must be this cohort. */
export function isCurrentCohortApplication(
  item: Pick<RemoteApplication, 'position' | 'batch' | 'recruitmentType'>,
  cohort: number,
) {
  const label = `${item.position} ${item.batch} ${item.recruitmentType ?? ''}`;
  if (/实习|intern|社会招聘|社招/i.test(label)) return false;
  const years = [...label.matchAll(/(20\d{2}|\b2\d)(?:届|年|\s*毕业|\s*(?:秋招|春招|校招))/g)].map(
    (match) => Number(match[1].length === 2 ? `20${match[1]}` : match[1]),
  );
  return !years.length || years.includes(cohort);
}
export const NOT_APPLIED_MESSAGE = '已登录，还没有投递。';
export type QueryResult =
  | {
      kind: 'success';
      applications: RemoteApplication[];
      applicationUrl?: string;
      note?: string;
    }
  | { kind: 'expired' | 'challenge' | 'error'; message: string };
export interface Bookmark {
  company: string;
  title: string;
  url: string;
  platform: ApplicationInput['platform'];
}
export interface BookmarkFolder {
  id: string;
  name: string;
  path: string;
  count: number;
}
export interface Dashboard {
  settings: Settings;
  onboarding: OnboardingState;
  ignored: IgnoredApplication[];
  applications: Application[];
  connections: Connection[];
  latestChanges: Record<string, History>;
  latestRun: RefreshRun | null;
  activeRun: RefreshRun | null;
  adapterCoverage: { platform: string; status: string }[];
}
export interface OnboardingState {
  active: boolean;
  currentId: string | null;
  queue: string[];
  results: {
    company: string;
    state: 'imported' | 'empty' | 'skipped' | 'error';
    imported: number;
    message: string;
  }[];
  message: string;
}
export function normalizeStatus(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
export function classifyStatus(raw: string): Stage {
  if (
    /人才库|不合适|未通过|不通过|拒绝|淘汰|终止|流程结束|(?<!面试)已结束|已撤回|放弃|未录用|已关闭|暂不匹配/.test(
      raw,
    )
  )
    return 'rejected';
  if (/offer|意向书|已录用|录用通知|录用意向|\bOC\b/i.test(raw)) return 'resolved';
  if (/待定|候补|泡池|等待机会|暂缓/.test(raw)) return 'pool';
  if (/面试|一面|二面|三面|终面|复试|复面/.test(raw)) return 'interview';
  const examAt = raw.search(/笔试|测评|考试|机试/);
  const resumeAt = raw.search(/简历筛选|初筛|筛选简历/);
  if (examAt >= 0 && (resumeAt < 0 || examAt > resumeAt)) return 'assessment';
  if (/筛选|初筛|简历|已投递|新投递|投递成功|待处理|申请已提交|(?<!录用)评估中/.test(raw))
    return 'screening';
  return 'unknown';
}
export function hasUnread(app: Application) {
  return !!app.lastChangeId && app.lastChangeId !== app.lastReadChangeId;
}
