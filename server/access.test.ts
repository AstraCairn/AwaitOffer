import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAccessIssue } from '../extension/src/access';
afterEach(() => vi.unstubAllGlobals());
function page(
  text: string,
  options: {
    form?: boolean;
    captcha?: boolean;
    hidden?: boolean;
    path?: string;
    hash?: string;
  } = {},
) {
  const element = {
    getClientRects: () => (options.hidden ? [] : [{}]),
    offsetHeight: options.hidden ? 0 : 30,
  };
  vi.stubGlobal('document', {
    body: { innerText: text },
    querySelectorAll: (selector: string) =>
      (selector.startsWith('input') ? options.form : options.captcha) ? [element] : [],
  });
  vi.stubGlobal('location', { pathname: options.path ?? '/application', hash: options.hash ?? '' });
}
describe('visible login and verification reminders', () => {
  it('identifies the login form and gives an explicit recovery instruction', () => {
    page('手机号 验证码 登录', { form: true });
    expect(readAccessIssue()).toMatchObject({
      kind: 'expired',
      message: expect.stringContaining('去登录'),
    });
  });
  it('keeps captcha separate from an expired login', () => {
    page('请完成安全验证 拖动滑块 登录', { form: true, captcha: true });
    expect(readAccessIssue()?.kind).toBe('challenge');
  });
  it('does not mistake hidden login fields or future workflow text for a login failure', () => {
    page('简历筛选中 登录', { form: true, hidden: true });
    expect(readAccessIssue()).toBeNull();
    page('登录帮助 面试 Offer');
    expect(readAccessIssue()).toBeNull();
  });
  it('recognizes a login route without requiring access to credential fields', () => {
    page('欢迎', { path: '/', hash: '#/login' });
    expect(readAccessIssue()?.kind).toBe('expired');
  });
  it('leaves an unrecognized or partially loaded page as unknown rather than claiming login expired', () => {
    page('加载中');
    expect(readAccessIssue()).toBeNull();
  });
});
