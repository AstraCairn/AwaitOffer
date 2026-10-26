import { existsSync, readFileSync } from 'node:fs';

const packageFile = [
  new URL('../package.json', import.meta.url),
  new URL('../../package.json', import.meta.url),
].find((file) => existsSync(file));
if (!packageFile) throw new Error('未找到 AwaitOffer package.json。');
export const version = (JSON.parse(readFileSync(packageFile, 'utf8')) as { version: string })
  .version;
