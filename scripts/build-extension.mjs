import { build } from 'esbuild';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'shared/sites.ts'), 'utf8');
const block = source.match(/export const careerSitePatterns = \[([\s\S]*?)\];/);
if (!block) throw new Error('shared/sites.ts 缺少 careerSitePatterns。');
const careerSitePatterns = [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (!careerSitePatterns.length) throw new Error('careerSitePatterns 为空。');

const manifestPath = resolve(root, 'extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [...careerSitePatterns, 'http://127.0.0.1:3182/*'];
for (const script of manifest.content_scripts ?? []) script.matches = [...careerSitePatterns];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const version = manifest.version;
await build({
  entryPoints: [
    'extension/src/capture.ts',
    'extension/src/content.ts',
    'extension/src/background.ts',
    'extension/src/popup.ts',
  ],
  outdir: 'extension',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
  legalComments: 'none',
  define: { AWAIT_OFFER_EXTENSION_VERSION: JSON.stringify(version) },
});
writeFileSync('extension/build-info.json.tmp', JSON.stringify({ version }));
renameSync('extension/build-info.json.tmp', 'extension/build-info.json');
console.log('日常 Edge 扩展已构建到 extension/');
