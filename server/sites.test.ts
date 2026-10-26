import { describe, expect, it } from 'vitest';
import {
  careerSitePatterns,
  detectPlatform,
  matchHostPattern,
  supportsAuto,
} from '../shared/sites.js';

describe('career site catalog', () => {
  it('matches Feishu / Moka / Beisen wildcards the old origin-equality helper rejected', () => {
    expect(
      matchHostPattern(
        'https://*.jobs.feishu.cn/*',
        'https://ponyai.jobs.feishu.cn/campus/position/application',
      ),
    ).toBe(true);
    expect(matchHostPattern('https://*.mokahr.com/*', 'https://app.mokahr.com/campus-recruitment/tuhu/1')).toBe(
      true,
    );
    expect(matchHostPattern('https://*.zhiye.com/*', 'https://transsion.zhiye.com/campus')).toBe(true);
    expect(matchHostPattern('https://career.huawei.com/*', 'https://career.huawei.com/cn/personal-center')).toBe(
      true,
    );
    expect(matchHostPattern('https://hr-campus.vivo.com/*', 'https://hr-campus.vivo.com/personal/deliveryRecord')).toBe(
      true,
    );
    expect(
      matchHostPattern('https://*.jobs.feishu.cn/*', 'https://id1.cloud.huawei.com/CAS/portal/login.html'),
    ).toBe(false);
    expect(matchHostPattern('http://127.0.0.1:3182/*', 'http://127.0.0.1:3182/extension/jobs')).toBe(true);
    expect(
      careerSitePatterns.some((pattern) =>
        matchHostPattern(pattern, 'https://anker-in.jobs.feishu.cn/campus/position/application'),
      ),
    ).toBe(true);
  });
  it('treats vivo campus as Beisen and leaves self-built hosts manual', () => {
    expect(detectPlatform('https://hr-campus.vivo.com/personal/deliveryRecord')).toBe('beisen');
    expect(supportsAuto('https://hr-campus.vivo.com/personal/deliveryRecord')).toBe(true);
    expect(detectPlatform('https://ponyai.jobs.feishu.cn/campus')).toBe('feishu');
    expect(detectPlatform('https://app.mokahr.com/campus-recruitment/shopee/1')).toBe('moka');
    expect(supportsAuto('https://www.lixiang.com/campus')).toBe(false);
    expect(supportsAuto('https://jobs.bilibili.com/campus')).toBe(false);
    expect(supportsAuto('https://campus.jd.com/#/myDeliver')).toBe(true);
  });
});
