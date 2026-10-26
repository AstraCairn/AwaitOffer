import { z } from 'zod';
import {
  detectPlatform,
  normalizeAppliedAt,
  type RemoteApplication,
} from './model.js';

const shapeType = z.enum(['string', 'number', 'boolean', 'null', 'array', 'object']);
export type ShapeType = z.infer<typeof shapeType>;
export const shapeSchema = z
  .object({
    route: z
      .string()
      .max(300)
      .regex(/^\/[^?#]*$/),
    fields: z
      .array(z.object({ path: z.string().max(300), type: shapeType }).strict())
      .max(300),
  })
  .strict();
export type JsonShape = z.infer<typeof shapeSchema>;
const sensitiveKey = /token|cookie|password|phone|email|avatar|contact|address|education|account/i;
const keyPattern = /^[A-Za-z_$][\w$-]{0,79}$/;
export const fieldPathsSchema = z
  .object({
    list: z.string().max(300),
    id: z.string().min(1).max(120),
    position: z.string().min(1).max(120),
    status: z.string().min(1).max(120),
    appliedAt: z.string().min(1).max(120),
    batch: z.string().max(120).default(''),
  })
  .strict();
export type FieldPaths = z.infer<typeof fieldPathsSchema>;
export const fieldMapSampleSchema = z
  .object({
    list: z.string().max(300),
    values: z.record(z.string().max(80), z.string().max(80)),
  })
  .strict()
  .refine((sample) => Object.keys(sample.values).length <= 40, '样例字段过多');
export type FieldMapSample = z.infer<typeof fieldMapSampleSchema>;

/** Confirmed delivery-time path. Position and progress stay on the hand-written parser. */
export const builtinFieldMaps: { host: string; paths: FieldPaths }[] = [
  {
    host: 'career.huawei.com',
    paths: {
      list: 'data.items',
      id: 'applicationProfileId',
      position: 'externalJobName',
      status: 'applicationStatus',
      appliedAt: 'applicationTime',
      batch: 'recruitSceneName',
    },
  },
];

function valueType(value: unknown): ShapeType | null {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  return shapeType.safeParse(type).success ? (type as ShapeType) : null;
}
export function summarizeValue(value: unknown): JsonShape['fields'] {
  const fields: JsonShape['fields'] = [];
  const visit = (item: unknown, path: string, depth: number) => {
    if (depth > 5 || fields.length >= 300) return;
    const type = valueType(item);
    if (!type) return;
    fields.push({ path, type });
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 1)) visit(child, path + '[]', depth + 1);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const key of Object.keys(item).slice(0, 40)) {
      if (!keyPattern.test(key) || sensitiveKey.test(key)) continue;
      visit((item as Record<string, unknown>)[key], path ? path + '.' + key : key, depth + 1);
    }
  };
  visit(value, '', 0);
  return fields;
}
export function directFields(fields: JsonShape['fields'], list: string): [string, ShapeType][] {
  const prefix = list + '[].';
  return fields.flatMap((field) => {
    if (!field.path.startsWith(prefix)) return [];
    const key = field.path.slice(prefix.length);
    if (!key || key.includes('.') || key.includes('[]')) return [];
    return [[key, field.type]];
  });
}
export function listPaths(shapes: JsonShape[]): string[] {
  const found = new Set<string>();
  for (const shape of shapes)
    for (const field of shape.fields) if (field.type === 'array' && field.path) found.add(field.path);
  return [...found];
}
export function candidateLists(shapes: JsonShape[]): string[] {
  return listPaths(shapes).filter((list) => {
    const fields = directFields(
      shapes.flatMap((shape) => shape.fields),
      list,
    );
    const dated = fields.some(
      ([key, type]) => /time|date/i.test(key) && (type === 'string' || type === 'number'),
    );
    return dated && fields.some(([, type]) => type === 'string');
  });
}
export function datePathsFromShapes(shapes: JsonShape[]): string[] {
  const paths = new Set<string>();
  for (const shape of shapes)
    for (const field of shape.fields)
      if ((field.type === 'string' || field.type === 'number') && /time|date/i.test(field.path))
        paths.add(field.path);
  return [...paths].slice(0, 40);
}
function at(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function arraysAt(payloads: unknown[], list: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const payload of payloads) {
    const value = at(payload, list);
    if (!Array.isArray(value)) continue;
    for (const item of value.slice(0, 1000))
      if (item && typeof item === 'object' && !Array.isArray(item))
        rows.push(item as Record<string, unknown>);
  }
  return rows;
}
export function redactSample(record: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(record).slice(0, 40)) {
    if (!keyPattern.test(key) || sensitiveKey.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      values[key] = normalizeAppliedAt(value) ? String(value) : 'number';
      continue;
    }
    if (typeof value !== 'string') {
      const type = valueType(value);
      if (type) values[key] = type;
      continue;
    }
    if (normalizeAppliedAt(value)) {
      values[key] = value.trim().slice(0, 40);
      continue;
    }
    if (value.length <= 40 && /[一-鿿]/.test(value) && !/\d{7,}/.test(value)) {
      values[key] = value;
      continue;
    }
    values[key] = 'string';
  }
  return values;
}
export function samplesFromPayloads(payloads: unknown[]): FieldMapSample[] {
  const samples: FieldMapSample[] = [];
  for (const payload of payloads) {
    const fields = summarizeValue(payload);
    for (const list of candidateLists([{ route: '/payload', fields }])) {
      const row = arraysAt([payload], list)[0];
      if (!row || samples.some((sample) => sample.list === list)) continue;
      samples.push({ list, values: redactSample(row) });
      if (samples.length >= 8) return samples;
    }
  }
  return samples;
}
function lookup(record: Record<string, unknown>, path: string): unknown {
  return at(record, path);
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
function textualStatus(value: string) {
  return value.length > 0 && value.length <= 200 && !/^\d+$/.test(value);
}
export function extractFieldMap(payloads: unknown[], paths: FieldPaths): RemoteApplication[] {
  return arraysAt(payloads, paths.list).flatMap((row) => {
    const id = text(lookup(row, paths.id)).slice(0, 512);
    const position = text(lookup(row, paths.position)).slice(0, 200);
    const rawStatus = text(lookup(row, paths.status));
    const appliedAt = normalizeAppliedAt(lookup(row, paths.appliedAt));
    const batch = text(lookup(row, paths.batch)).slice(0, 100);
    if (!id || !position) return [];
    return [
      {
        id,
        position,
        batch,
        rawStatus: textualStatus(rawStatus) ? rawStatus : '',
        ...(appliedAt ? { appliedAt } : {}),
      },
    ];
  });
}
/** Fill a missing delivery time. Replace records only when the hand parser found none. */
export function applyFieldMap(
  payloads: unknown[],
  existing: RemoteApplication[],
  paths: FieldPaths,
): RemoteApplication[] {
  const extracted = extractFieldMap(payloads, paths);
  if (!existing.length)
    return extracted.filter((item) => item.rawStatus && textualStatus(item.rawStatus));
  return existing.map((app) => {
    if (app.appliedAt) return app;
    const hits = extracted.filter(
      (row) =>
        row.appliedAt &&
        (row.id === app.id ||
          (row.position === app.position && (!app.batch || !row.batch || row.batch === app.batch))),
    );
    return hits.length === 1 ? { ...app, appliedAt: hits[0].appliedAt } : app;
  });
}
export function pathExists(shapes: JsonShape[], list: string, relative: string) {
  if (!relative) return true;
  const full = `${list}[].${relative}`;
  return shapes.some((shape) => shape.fields.some((field) => field.path === full));
}
export function validateFieldMap(
  shapes: JsonShape[],
  samples: FieldMapSample[],
  paths: FieldPaths,
): boolean {
  if (!shapes.some((shape) => shape.fields.some((field) => field.path === paths.list && field.type === 'array')))
    return false;
  for (const relative of [paths.id, paths.position, paths.status, paths.appliedAt, paths.batch])
    if (relative && !pathExists(shapes, paths.list, relative)) return false;
  const sample = samples.find((item) => item.list === paths.list);
  if (!sample) return false;
  const status = sample.values[paths.status];
  const appliedAt = sample.values[paths.appliedAt];
  const position = sample.values[paths.position];
  return (
    !!position &&
    position !== 'string' &&
    textualStatus(status ?? '') &&
    /[一-鿿]/.test(status ?? '') &&
    !!appliedAt &&
    !!normalizeAppliedAt(/^\d{10,13}$/.test(appliedAt) ? Number(appliedAt) : appliedAt)
  );
}
export function shouldRequestFieldMap(
  url: string,
  applications: RemoteApplication[],
  shapes: JsonShape[],
) {
  if (detectPlatform(url) !== 'custom') return false;
  const lists = candidateLists(shapes);
  if (!lists.length) return false;
  if (applications.some((app) => !app.appliedAt)) return true;
  if (applications.length) return false;
  const fields = lists.flatMap((list) => directFields(shapes.flatMap((shape) => shape.fields), list));
  return fields.some(([key]) => /apply|deliver|resume|record|submission|application/i.test(key));
}
export function builtinFieldMap(host: string, shapes: JsonShape[]): FieldPaths | null {
  const found = builtinFieldMaps.find((map) => map.host === host);
  if (!found || !pathExists(shapes, found.paths.list, found.paths.appliedAt)) return null;
  return found.paths;
}
export function deliveryTimeText(values: string[]): string | null {
  for (const value of values) {
    const appliedAt = normalizeAppliedAt(value);
    if (appliedAt) return appliedAt;
  }
  return null;
}
export const FIELD_MAP_NOTE = '这个官网的字段还没对照';
