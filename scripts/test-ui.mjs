import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const screenshots = process.argv.includes('--screenshots');
await mkdir('test-results', { recursive: true });
if (screenshots) await mkdir('docs/images', { recursive: true });
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tests/ui-fixture.ts'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});
let base;
let browser;
let currentPage;
const errors = [];
const blocked = [];
const checks = [];
async function check(name, work) {
  await work();
  checks.push(name);
  console.log(`  PASS ${name}`);
}
async function expectText(locator, text) {
  await locator.filter({ hasText: text }).first().waitFor({ state: 'visible' });
}
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    base = output.match(/UI_FIXTURE_URL=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (base) break;
    if (child.exitCode !== null) throw new Error(`UI fixture exited: ${output}`);
    await delay(100);
  }
  assert.ok(base, `UI fixture startup timed out: ${output}`);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function session({
    scenario = 'seed',
    size = { width: 1440, height: 900 },
    connected = true,
    guideDone = true,
  } = {}) {
    const response = await fetch(`${base}/__test/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
    });
    assert.ok(response.ok);
    const context = await browser.newContext({
      viewport: size,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      acceptDownloads: true,
    });
    await context.addInitScript(
      ({ guideDone }) => {
        if (guideDone) localStorage.setItem('awaitoffer-guide-v1', 'done');
      },
      { guideDone },
    );
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:3182') {
        if (url.pathname === '/api/setup')
          return route.fulfill({
            json: {
              connected,
              paired: connected,
              extensionId: 'fixture',
              extensionDirectory: 'C:\\AwaitOffer-demo\\extension',
              lastSeenAt: connected ? new Date().toISOString() : null,
              edgeConnections: 0,
              preservedCompanies: [],
            },
          });
        return route.fulfill({ json: { ok: true } });
      }
      if (url.origin === base) return route.continue();
      blocked.push(url.origin);
      return route.abort();
    });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page
      .getByRole('heading', {
        name: guideDone || scenario !== 'empty' ? '投递工作台' : '把投递整理好',
        exact: false,
      })
      .waitFor();
    return { page, context };
  }
  async function addManual(page, company = '流程测试公司') {
    await page.getByRole('button', { name: '新增投递', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('公司名称').fill(company);
    await dialog.getByLabel('投递岗位').fill('前端工程师');
    await dialog.getByLabel('官网个人中心链接').fill('https://recruit.example.com/apply');
    await dialog.getByLabel('官网当前状态').fill('简历初筛');
    await dialog.getByRole('button', { name: '保存投递', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page
      .getByRole('button', { name: new RegExp(company) })
      .first()
      .waitFor();
  }
  await check('manual create, edit, history and unread state', async () => {
    const { page, context } = await session({ scenario: 'empty' });
    await addManual(page);
    await page.getByRole('button', { name: '编辑流程测试公司', exact: true }).click();
    await page.getByRole('dialog').getByLabel('官网当前状态').fill('一面');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '流程测试公司更多操作' }).click();
    await page.getByRole('button', { name: '历史时间轴', exact: true }).click();
    await expectText(page.getByRole('dialog'), '简历初筛');
    await expectText(page.getByRole('dialog'), '一面');
    await page.getByRole('button', { name: '标为已读', exact: true }).click();
    await page.getByRole('button', { name: '标为已读', exact: true }).waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('application-row').count(), 1);
    await context.close();
  });
  await check('search, stage, raw status, source and view filters', async () => {
    const { page, context } = await session();
    assert.equal(await page.getByTestId('application-row').count(), 9);
    await page.getByRole('textbox', { name: '搜索公司或岗位' }).fill('星河');
    assert.equal(await page.getByTestId('application-row').count(), 1);
    await page.getByRole('button', { name: '重置筛选' }).click();
    await page.getByLabel('筛选招聘阶段').selectOption('assessment');
    assert.equal(await page.getByTestId('application-row').count(), 2);
    await page.getByRole('button', { name: '重置筛选' }).click();
    await page.getByLabel('筛选原始状态').selectOption('Offer 已发放');
    assert.equal(await page.getByTestId('application-row').count(), 1);
    await page.getByRole('button', { name: '重置筛选' }).click();
    await page.getByLabel('筛选招聘系统').selectOption('feishu');
    assert.equal(await page.getByTestId('application-row').count(), 8);
    await page.getByRole('button', { name: '重置筛选' }).click();
    await page.getByRole('button', { name: '看板视图', exact: true }).click();
    await page.locator('.board-card').first().waitFor();
    assert.equal(await page.locator('.board-card').count(), 9);
    await page.reload();
    await page.locator('.board-card').first().waitFor();
    await page.getByRole('button', { name: '列表视图', exact: true }).click();
    await page
      .getByRole('button', { name: '未读变化', exact: false })
      .filter({ has: page.locator('span') })
      .first()
      .click();
    await page.getByTestId('application-row').first().waitFor();
    assert.equal(await page.getByTestId('application-row').count(), 2);
    await context.close();
  });
  await check('v2 export / restore, v1 restore and invalid-backup protection', async () => {
    const { page, context } = await session();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '导出备份', exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const backup = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(backup.version, 2);
    await addManual(page, '待恢复前记录');
    await page.locator('input[type=file]').setInputFiles({
      name: 'backup-v2.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page
      .getByRole('dialog', { name: '恢复本地备份' })
      .getByRole('button', { name: '恢复备份', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('application-row').count(), 9);
    assert.equal(await page.getByRole('button', { name: /待恢复前记录/ }).count(), 0);
    await page.locator('input[type=file]').setInputFiles({
      name: 'backup-v1.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...backup, version: 1 })),
    });
    await page.getByRole('dialog').getByRole('button', { name: '恢复备份', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('application-row').count(), 9);
    await page.locator('input[type=file]').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{bad-json'),
    });
    await expectText(page.getByRole('status'), '有效的 AwaitOffer');
    assert.equal(await page.getByRole('dialog').count(), 0);
    const invalid = structuredClone(backup);
    invalid.history[0].applicationId = '00000000-0000-4000-8000-000000000000';
    await page.locator('input[type=file]').setInputFiles({
      name: 'invalid-reference.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(invalid)),
    });
    await page.getByRole('dialog').getByRole('button', { name: '恢复备份', exact: true }).click();
    await expectText(page.getByRole('status'), /引用|不存在/);
    assert.equal(await page.getByTestId('application-row').count(), 9);
    await context.close();
  });
  await check('folder preview, same-name paths, empty folder and scoped import', async () => {
    const { page, context } = await session({ scenario: 'empty' });
    await page.getByRole('button', { name: '导入书签', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('测试导入公司', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.bookmark-item').count(), 2);
    await dialog.getByLabel('书签文件夹').selectOption('edge:5');
    await dialog.getByText('这个文件夹没有有效的 HTTP/HTTPS 入口，试试其他文件夹。').waitFor();
    await dialog.getByLabel('书签文件夹').selectOption({ label: '收藏夹栏 / 研发（1 个入口）' });
    await dialog.getByText('其他研发公司', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '导入 1 个入口', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('application-row').count(), 1);
    await page.getByRole('button', { name: '导入书签', exact: true }).click();
    await page.getByRole('dialog').getByText('测试导入公司', { exact: true }).waitFor();
    await fetch(`${base}/__test/remove-folder`, { method: 'POST' });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '导入 2 个入口', exact: true })
      .click();
    await expectText(page.getByRole('alert'), '重新选择');
    assert.equal(await page.getByTestId('application-row').count(), 1);
    await context.close();
  });
  await check(
    'first-run guide, confirmed cohort, optional browser and skip persistence',
    async () => {
      const { page, context } = await session({
        scenario: 'empty',
        guideDone: false,
        connected: false,
      });
      const year =
        Number(
          new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(
            new Date(),
          ),
        ) + 1;
      assert.equal(await page.getByLabel('毕业届别', { exact: true }).inputValue(), String(year));
      await page.getByLabel('毕业届别', { exact: true }).fill('2028');
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('heading', { name: '从你的第一条投递开始' }).waitFor();
      const dashboard = await (await fetch(`${base}/api/dashboard`)).json();
      assert.equal(dashboard.settings.cohort, 2028);
      await page.getByRole('button', { name: '暂不添加，继续' }).click();
      await page.getByRole('button', { name: '先用手动记录' }).click();
      await page.getByRole('heading', { name: '投递工作台', exact: false }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: '投递工作台', exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: '跳过引导' }).count(), 0);
      await context.close();
    },
  );
  await check('browser setup without automatic records and schedule presets', async () => {
    const { page, context } = await session({ scenario: 'empty' });
    let refreshCalls = 0;
    await page.route(`${base}/api/refresh`, (route) => {
      refreshCalls++;
      return route.fulfill({ status: 400, json: { message: 'No automatic records' } });
    });
    await page.getByRole('button', { name: 'Edge 已连接', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '完成连接', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(refreshCalls, 0);
    await page.getByRole('button', { name: '同步设置' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('同步频率').selectOption('360');
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await expectText(page.getByRole('status'), '同步设置已保存');
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).intervalMinutes, 360);
    await dialog.getByLabel('同步频率').selectOption('custom');
    await dialog.getByLabel('间隔（分钟）').fill('90');
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.waitForResponse(
      (response) => response.url() === `${base}/api/dashboard` && response.ok(),
    );
    assert.equal((await (await fetch(`${base}/api/settings`)).json()).intervalMinutes, 90);
    await dialog.getByRole('tab', { name: '同步计划', exact: true }).focus();
    await page.keyboard.press('End');
    assert.equal(
      await dialog.getByRole('tab', { name: '数据与备份' }).getAttribute('aria-selected'),
      'true',
    );
    await page.keyboard.press('Home');
    assert.equal(
      await dialog
        .getByRole('tab', { name: '同步计划', exact: true })
        .getAttribute('aria-selected'),
      'true',
    );
    await context.close();
  });
  await check(
    'sync connection explanation, failure preservation and accessible modal focus',
    async () => {
      const { page, context } = await session({ scenario: 'attention', connected: false });
      assert.ok(await page.getByRole('button', { name: '同步进度', exact: true }).isDisabled());
      assert.match(
        await page.getByRole('button', { name: '同步进度', exact: true }).getAttribute('title'),
        /连接 Edge/,
      );
      await page.locator('.attention-panel summary').click();
      await page.getByRole('button', { name: '去登录', exact: false }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.match(await page.evaluate(() => document.activeElement?.textContent), /去登录/);
      await page.getByRole('button', { name: '新增投递', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(
        await page
          .getByRole('button', { name: '新增投递', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await context.close();
    },
  );
  await check('responsive layouts and desktop first-screen records', async () => {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const { page, context } = await session({ size });
      await page.getByTestId('application-row').first().waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Page overflow at ${size.width}`,
      );
      await page.screenshot({
        path: `test-results/layout-${size.width}.png`,
        fullPage: size.width > 760,
      });
      if (size.width > 760) {
        const third = await page.getByTestId('application-row').nth(2).boundingBox();
        assert.ok(
          third.y + third.height <= size.height,
          `Third row outside first screen at ${size.width}: ${JSON.stringify(third)}`,
        );
        assert.ok(await page.getByLabel('筛选招聘阶段').isVisible());
      } else {
        await page.getByRole('button', { name: '展开或收起筛选' }).click();
        await page.getByLabel('筛选招聘阶段').selectOption('interview');
        assert.equal(await page.getByTestId('application-row').count(), 2);
        await page.getByRole('button', { name: '重置筛选' }).click();
        await page.getByRole('button', { name: '展开或收起筛选' }).click();
        await page.getByRole('button', { name: '打开导航菜单' }).click();
        await page
          .getByRole('navigation', { name: '移动导航' })
          .getByRole('button', { name: '官网连接', exact: true })
          .click();
        await page.getByRole('heading', { name: '公司连接', exact: false }).waitFor();
        assert.ok(
          await page
            .locator('.connection-list-item > div')
            .first()
            .evaluate((el) => el.clientWidth > 110),
        );
        await page.screenshot({ path: 'test-results/connections-390.png' });
        await page.getByRole('button', { name: '打开导航菜单' }).click();
        await page
          .getByRole('navigation', { name: '移动导航' })
          .getByRole('button', { name: '设置', exact: true })
          .click();
        await page.getByRole('dialog').getByRole('tab', { name: '数据与备份' }).click();
        assert.ok(
          await page
            .getByRole('dialog')
            .getByRole('button', { name: '恢复备份', exact: true })
            .isVisible(),
        );
      }
      await context.close();
    }
  });
  await check('offline service and failed sync keep last successful progress', async () => {
    const { page, context } = await session();
    await page.route(`${base}/api/dashboard`, (route) => route.abort());
    await page.getByRole('button', { name: '同步设置' }).click();
    await page.keyboard.press('Escape');
    await page.locator('.offline-banner').waitFor({ timeout: 10000 });
    assert.equal(await page.getByTestId('application-row').count(), 9);
    await page.unroute(`${base}/api/dashboard`);
    await page.getByRole('button', { name: '重试连接' }).click();
    await page.locator('.offline-banner').waitFor({ state: 'hidden' });
    await page.route(`${base}/api/refresh`, (route) =>
      route.fulfill({ status: 400, json: { message: '同步失败，已保留原进度' } }),
    );
    await page.getByRole('button', { name: '同步进度', exact: true }).click();
    await expectText(page.getByRole('status'), '已保留原进度');
    assert.equal(await page.getByTestId('application-row').count(), 9);
    await context.close();
  });
  if (screenshots)
    await check('export three documentation screenshots using fictional records', async () => {
      const { page, context } = await session();
      await page.getByTestId('application-row').nth(2).waitFor();
      await page.screenshot({ path: 'docs/images/workbench.png' });
      await page.getByRole('button', { name: '看板视图', exact: true }).click();
      await page.locator('.board-card').first().waitFor();
      await page.screenshot({ path: 'docs/images/board.png' });
      await context.close();
      const guide = await session({ scenario: 'empty', guideDone: false, connected: false });
      await guide.page.screenshot({ path: 'docs/images/getting-started.png', fullPage: true });
      await guide.context.close();
    });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  assert.deepEqual(blocked, [], `Unexpected external requests: ${blocked.join(', ')}`);
  console.log(
    `\n${checks.length} UI scenarios passed. Real browser bridge, recruitment accounts and xAI were not contacted.`,
  );
} catch (error) {
  if (currentPage && !currentPage.isClosed())
    await currentPage
      .screenshot({ path: 'test-results/failure.png', fullPage: true })
      .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (base) {
    await fetch(`${base}/__test/shutdown`, { method: 'POST' }).catch(() => {});
    await Promise.race([once(child, 'exit'), delay(5000)]);
  }
  if (child.exitCode === null) child.kill();
}
