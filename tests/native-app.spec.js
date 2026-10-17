// App（Capacitor）内发往 /proxy/ 的请求改用原生 HTTP 直连（js/native-app.js），与服务端代理一样只允许公网地址
import { test, expect } from '@playwright/test';
import { prepare, login } from './helpers.js';

test('App 内的原生请求拒绝本机与局域网地址，公网地址照常请求', async ({ page }) => {
    await prepare(page);
    await login(page);
    await page.addInitScript(() => {
        window.nativeRequests = [];
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
            Plugins: {
                CapacitorHttp: {
                    request: async ({ url }) => {
                        window.nativeRequests.push(url);
                        return { status: 200, data: '{"list":[]}', headers: { 'Content-Type': 'application/json' } };
                    }
                }
            }
        };
    });
    await page.goto('/');

    const result = await page.evaluate(async () => {
        const statusOf = async url => (await fetch(PROXY_URL + encodeURIComponent(url))).status;
        return {
            lan: await statusOf('http://192.168.1.1/api.php/provide/vod?ac=list'),
            localhost: await statusOf('http://localhost:8080/'),
            metadata: await statusOf('http://169.254.169.254/latest/meta-data/'),
            publicSite: await statusOf('https://cj.rycjapi.com/api.php/provide/vod?ac=list'),
            requested: window.nativeRequests
        };
    });
    expect(result).toEqual({
        lan: 400,
        localhost: 400,
        metadata: 400,
        publicSite: 200,
        requested: ['https://cj.rycjapi.com/api.php/provide/vod?ac=list']
    });
});
