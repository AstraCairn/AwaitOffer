import type { QueryResult } from '../../shared/model';

/** Read visible authentication UI only. A parsing timeout is never treated as a login failure. */
export function readAccessIssue(): Exclude<QueryResult, { kind: 'success' }> | null {
  const shown = (element: Element) =>
    !!(element.getClientRects().length && (element as HTMLElement).offsetHeight);
  const text = document.body?.innerText ?? '';
  if (
    [
      ...document.querySelectorAll(
        '[class*="captcha"], [class*="verify-wrap"], iframe[src*="captcha"]',
      ),
    ].some(shown) &&
    /拖动|滑块|安全验证|请完成验证|验证码/.test(text)
  )
    return {
      kind: 'challenge',
      message: '官网要求人工验证。点击“去验证”打开查询窗口，完成后会自动读取；已有进度已保留。',
    };
  const loginForm = [
    ...document.querySelectorAll(
      'input[type="password"],input[type="tel"],input[placeholder*="验证码"],input[placeholder*="手机号"],input[placeholder*="手机号码"]',
    ),
  ].some(shown);
  const loginRoute = /\/(?:login|signin|auth\/login)(?:\/|\?|#|$)/i.test(
    location.pathname + location.hash,
  );
  if ((loginForm && /登录|登入|验证码|查询/.test(text)) || loginRoute)
    return {
      kind: 'expired',
      message:
        '官网尚未登录或登录已过期。点击“去登录”打开查询窗口，登录后进入“我的投递”；已有进度已保留。',
    };
  return null;
}
