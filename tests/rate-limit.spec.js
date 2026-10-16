// 登录限流（Worker 的 RateLimiter，见 worker.js；测试中放宽为每分钟 20 次，见 playwright.config.js）
import { test, expect } from '@playwright/test';

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
