// Worker 的限流（RateLimiter，见 worker.js）。登录测试中放宽为每分钟 20 次（见 playwright.config.js），代理为默认的 300 次。
import { test, expect } from '@playwright/test';
import { PASSWORD } from './helpers.js';

// 放在登录限流测试之前：登录限流触发后本 IP 一分钟内无法登录
test('代理请求超过每分钟 300 次后返回 429，之后持续拒绝', async ({ page }) => {
    expect((await page.request.post('/auth/login', { data: { password: PASSWORD } })).status()).toBe(200);
    // 目标是内网地址，代理直接拒绝（400），不会请求外部网站
    const blocked = '/proxy/' + encodeURIComponent('http://127.0.0.1/');
    const statuses = [];
    for (let i = 0; i < 400; i++) statuses.push((await page.request.get(blocked)).status());
    const first429 = statuses.indexOf(429);
    // 代理计数每 10 次汇总一次，超限后最多多放行一批
    expect(first429).toBeGreaterThanOrEqual(300);
    expect(first429).toBeLessThanOrEqual(330);
    expect(statuses.slice(0, first429).every(status => status === 400)).toBe(true);
    expect(statuses.slice(first429).every(status => status === 429)).toBe(true);
});

test('连续登录失败超过限制后返回 429，页面提示稍后再试', async ({ page }) => {
    let status = 0;
    for (let i = 0; i < 25 && status !== 429; i++) {
        status = (await page.request.post('/auth/login', { data: { password: 'wrong-' + i } })).status();
    }
    expect(status).toBe(429);

    await page.addInitScript(() => localStorage.setItem('hasSeenDisclaimer', 'true'));
    await page.goto('/');
    await page.fill('#passwordInput', 'test-pass');
    await page.click('#passwordSubmitBtn');
    await expect(page.locator('#passwordError')).toHaveText('尝试次数过多，请一分钟后再试');
});
