// 访问密码、管理员密码与代理保护（见 lib/auth.mjs、lib/target-guard.mjs）
import { test, expect } from '@playwright/test';
import { PASSWORD, ADMIN_PASSWORD, prepare, login } from './helpers.js';

const proxyPath = target => '/proxy/' + encodeURIComponent(target);

test('页面不包含密码信息，未登录时要求输入密码', async ({ page }) => {
    await prepare(page);
    const html = await (await page.request.get('/')).text();
    expect(html).not.toMatch(/[0-9a-f]{64}/);
    expect(html).toContain('"passwordRequired":true');

    await page.goto('/');
    await expect(page.locator('#passwordModal')).toBeVisible();
});

test('密码错误提示，正确后可使用，刷新后保持登录', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.fill('#passwordInput', 'wrong');
    await page.click('#passwordSubmitBtn');
    await expect(page.locator('#passwordError')).toBeVisible();

    await page.fill('#passwordInput', PASSWORD);
    await page.click('#passwordSubmitBtn');
    await expect(page.locator('#passwordModal')).toBeHidden();

    await page.reload();
    await expect(page.locator('#passwordModal')).toBeHidden();
});

test('代理只对已登录用户开放', async ({ page }) => {
    const before = await page.request.get(proxyPath('https://example.com/'));
    expect(before.status()).toBe(401);
});

test('代理拒绝本机、内网与云元数据地址', async ({ page }) => {
    await login(page);
    for (const target of [
        'http://127.0.0.1/', 'http://localhost/', 'http://192.168.1.1/', 'http://10.0.0.1/',
        'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'file:///etc/passwd'
    ]) {
        const response = await page.request.get(proxyPath(target));
        expect(response.status(), target).toBe(400);
    }
});

test('伪造的登录 Cookie 无效', async ({ page, context }) => {
    await context.addCookies([{ name: 'pa_session', value: `${Date.now() + 1e9}.${'0'.repeat(64)}`, url: 'http://localhost:8099' }]);
    const response = await page.request.get(proxyPath('https://example.com/'));
    expect(response.status()).toBe(401);
});

test('设置面板需要管理员密码，访问密码不能代替', async ({ page }) => {
    await prepare(page);
    await login(page);
    await page.goto('/');
    await page.click('button[aria-label="打开设置"]');
    await expect(page.locator('#passwordModal h2')).toHaveText('管理员验证');

    await page.fill('#passwordInput', PASSWORD);
    await page.click('#passwordSubmitBtn');
    await expect(page.locator('#passwordError')).toBeVisible();

    await page.fill('#passwordInput', ADMIN_PASSWORD);
    await page.click('#passwordSubmitBtn');
    await expect(page.locator('#settingsPanel')).toHaveClass(/show/);
});
