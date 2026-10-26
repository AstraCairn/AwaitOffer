import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const fileSchema = z.object({ apiKey: z.string().min(20).max(300) }).strict();
function fileFor(dataDir: string) {
  return join(dataDir, 'llm.json');
}
export function readLlmKey(dataDir: string): string | null {
  const fromEnv = process.env.XAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = fileFor(dataDir);
  if (!existsSync(file)) return null;
  const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  return parsed.success ? parsed.data.apiKey : null;
}
export function llmConfigured(dataDir: string) {
  return !!readLlmKey(dataDir);
}
export function writeLlmKey(dataDir: string, apiKey: string) {
  const file = fileFor(dataDir);
  if (!apiKey) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  fileSchema.parse({ apiKey });
  writeFileSync(file, JSON.stringify({ apiKey }), { mode: 0o600 });
}
