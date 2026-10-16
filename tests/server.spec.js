// 服务端行为（Node 版与 Worker 都会运行，见 playwright.config.js）：只发布网站文件、页面路由、代理请求方法
import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

test('只发布网站文件，服务端代码、配置与依赖不可访问', async ({ request }) => {
    for (const path of ['/server.mjs', '/worker.js', '/package.json', '/wrangler.jsonc', '/lib/auth.mjs',
        '/scripts/build.mjs', '/tests/helpers.js', '/node_modules/.package-lock.json', '/.env', '/css/tailwind.src.css']) {
        const response = await request.get(path);
        expect(response.status(), path).toBe(404);
    }
    expect((await request.get('/manifest.json')).status()).toBe(200);
});

test('搜索页地址 /s=关键词 返回首页并写入登录状态', async ({ request }) => {
    const response = await request.get('/s=' + encodeURIComponent('测试'), { headers: { Accept: 'text/html' } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('"passwordRequired":true');
    expect(response.headers()['cache-control']).toBe('no-store');
});

test('代理只接受 GET 请求', async ({ page }) => {
    await login(page);
    const response = await page.request.post('/proxy/' + encodeURIComponent('https://example.com/'));
    expect(response.status()).toBe(405);
});
