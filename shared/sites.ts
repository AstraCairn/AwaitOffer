export type CareerPlatform = 'feishu' | 'moka' | 'beisen' | 'custom';

/** MV3 host / content-script match patterns. Build injects these into the extension manifest. */
export const careerSitePatterns = [
  'https://*.jobs.feishu.cn/*',
  'https://*.mokahr.com/*',
  'https://*.zhiye.com/*',
  'https://we.zyt.com/*',
  'https://apply.careers.dji.com/*',
  'https://hr-campus.vivo.com/*',
  'https://career.huawei.com/*',
  'https://campus-talent.alibaba.com/*',
  'https://campus.kuaishou.cn/*',
  'https://jobs.mihoyo.com/*',
  'https://career.honor.com/*',
  'https://join.qq.com/*',
  'https://talent.lenovo.com.cn/*',
  'https://talent.baidu.com/*',
  'https://campus.jd.com/*',
  'https://talent.antgroup.com/*',
];

export const customSites = [
  'career.huawei.com',
  'campus-talent.alibaba.com',
  'campus.kuaishou.cn',
  'jobs.mihoyo.com',
  'career.honor.com',
  'join.qq.com',
  'talent.lenovo.com.cn',
  'talent.baidu.com',
  'campus.jd.com',
  'talent.antgroup.com',
];

/** Chrome match pattern: scheme://host/path, where host may be *.example.com. */
export function matchHostPattern(pattern: string, href: string): boolean {
  try {
    const url = new URL(href);
    const parsed = pattern.match(/^(https?|\*):\/\/([^/]+)(\/.*)$/);
    if (!parsed) return false;
    const [, scheme, host, pathPattern] = parsed;
    if (scheme === '*') {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    } else if (url.protocol !== `${scheme}:`) return false;
    const hostname = url.hostname.toLowerCase();
    const patternHost = host.toLowerCase();
    if (patternHost !== '*') {
      const split = patternHost.lastIndexOf(':');
      const hostHasPort = split > 0 && /^\d+$/.test(patternHost.slice(split + 1));
      const hostName = hostHasPort ? patternHost.slice(0, split) : patternHost;
      const hostPort = hostHasPort ? patternHost.slice(split + 1) : '';
      if (hostPort) {
        const actualPort =
          url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
        if (actualPort !== hostPort) return false;
      }
      if (hostName.startsWith('*.')) {
        const root = hostName.slice(2);
        if (hostname !== root && !hostname.endsWith(`.${root}`)) return false;
      } else if (hostname !== hostName) return false;
    }
    return matchGlob(pathPattern, `${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

function matchGlob(pattern: string, value: string): boolean {
  let i = 0,
    j = 0,
    star = -1,
    mark = 0;
  while (j < value.length) {
    if (i < pattern.length && pattern[i] === '*') {
      star = i++;
      mark = j;
      continue;
    }
    if (i < pattern.length && pattern[i] === value[j]) {
      i++;
      j++;
      continue;
    }
    if (star !== -1) {
      i = star + 1;
      j = ++mark;
      continue;
    }
    return false;
  }
  while (i < pattern.length && pattern[i] === '*') i++;
  return i === pattern.length;
}

export function detectPlatform(url: string): CareerPlatform {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === 'jobs.feishu.cn' || hostname.endsWith('.jobs.feishu.cn')) return 'feishu';
  if (hostname === 'mokahr.com' || hostname.endsWith('.mokahr.com')) return 'moka';
  if (hostname === 'apply.careers.dji.com') return 'moka';
  if (hostname === 'zhiye.com' || hostname.endsWith('.zhiye.com')) return 'beisen';
  if (hostname === 'we.zyt.com' || hostname === 'hr-campus.vivo.com') return 'beisen';
  return 'custom';
}

export function supportsAuto(url: string) {
  try {
    return detectPlatform(url) !== 'custom' || customSites.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
