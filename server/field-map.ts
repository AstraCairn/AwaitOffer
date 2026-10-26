import { createHash } from 'node:crypto';
import { detectPlatform } from '../shared/model.js';
import {
  builtinFieldMap,
  candidateLists,
  directFields,
  fieldPathsSchema,
  validateFieldMap,
  type FieldMapSample,
  type FieldPaths,
  type JsonShape,
} from '../shared/field-map.js';
import { readLlmKey } from './llm-key.js';
import type { Store } from './store.js';

export type FieldMapReason = 'ready' | 'cached' | 'builtin' | 'unconfigured' | 'rejected' | 'known-platform' | 'empty';
export type FieldMapModel = (prompt: string) => Promise<string>;

function fingerprint(shapes: JsonShape[], list: string) {
  return createHash('sha256')
    .update(
      directFields(
        shapes.flatMap((shape) => shape.fields),
        list,
      )
        .map(([key, type]) => `${key}:${type}`)
        .sort()
        .join('\n'),
    )
    .digest('hex');
}
function jsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('字段对照不是 JSON。');
  return JSON.parse(body.slice(start, end + 1));
}
export function readModelText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === 'string' && record.output_text.trim()) return record.output_text;
  if (!Array.isArray(record.output)) return '';
  const parts: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== 'object' || !Array.isArray((item as { content?: unknown }).content))
      continue;
    for (const content of (item as { content: { text?: unknown }[] }).content)
      if (typeof content?.text === 'string') parts.push(content.text);
  }
  return parts.join('\n');
}
export async function xaiFieldMap(dataDir: string, prompt: string): Promise<string> {
  const apiKey = readLlmKey(dataDir);
  if (!apiKey) throw new Error('未配置字段对照密钥。');
  const response = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'grok-4.7', input: prompt }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('字段对照请求失败。');
  const text = readModelText(await response.json());
  if (!text.trim()) throw new Error('字段对照没有返回内容。');
  return text;
}
function promptFor(shapes: JsonShape[], samples: FieldMapSample[]) {
  return [
    '你只返回一个 JSON 对象，不要解释。',
    '从招聘官网投递 JSON 的结构里指出字段路径。',
    'list 是记录数组的路径，用点号连接，不要写 []。',
    'id、position、status、appliedAt、batch 是数组元素上的相对路径。batch 不确定就用空字符串。',
    'status 必须是给人看的进度文字，不能是纯数字编码。',
    'appliedAt 必须是投递或申请时间，不能是职位发布时间或更新时间。',
    '无法确定的路径用空字符串。',
    '结构：',
    JSON.stringify(shapes).slice(0, 12000),
    '样例：',
    JSON.stringify(samples).slice(0, 4000),
  ].join('\n');
}
export async function resolveFieldMap(
  store: Store,
  origin: string,
  shapes: JsonShape[],
  samples: FieldMapSample[],
  model: FieldMapModel | null,
): Promise<{ map: FieldPaths | null; reason: FieldMapReason }> {
  const host = new URL(origin).hostname;
  if (detectPlatform(`https://${host}/`) !== 'custom') return { map: null, reason: 'known-platform' };
  const lists = candidateLists(shapes);
  if (!lists.length) return { map: null, reason: 'empty' };
  const builtin = builtinFieldMap(host, shapes);
  if (builtin) return { map: builtin, reason: 'builtin' };
  for (const list of lists) {
    const saved = store.fieldMap(host, fingerprint(shapes, list));
    if (saved) return { map: saved, reason: 'cached' };
  }
  if (!model) return { map: null, reason: 'unconfigured' };
  try {
    const parsed = fieldPathsSchema.parse(jsonObject(await model(promptFor(shapes, samples))));
    const list = lists.find((item) => item === parsed.list) ?? parsed.list;
    if (!validateFieldMap(shapes, samples, { ...parsed, list }))
      return { map: null, reason: 'rejected' };
    const paths = { ...parsed, list };
    store.saveFieldMap({
      host,
      fingerprint: fingerprint(shapes, paths.list),
      paths,
      source: 'llm',
    });
    return { map: paths, reason: 'ready' };
  } catch {
    return { map: null, reason: 'rejected' };
  }
}
