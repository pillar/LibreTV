// lib/proxy.mjs 的行为：跳转目标同样要通过检查；源站返回的 HTML 不能以页面形式交给浏览器
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { proxyFetch } from '../lib/proxy.mjs';
import { handleRequest } from '../lib/handler.mjs';

let server;
let origin;

test.beforeAll(async () => {
    server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
            res.writeHead(302, { Location: '/secret' });
            return res.end();
        }
        if (req.url === '/page') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<script>alert(1)</script>');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"secret":true}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(() => server.close());

// 测试服务器在本机，用自定义检查代替默认的内网拦截：只放行 /redirect 与 /page
const onlyPublicPaths = url => ['/redirect', '/page'].includes(new URL(url).pathname);

test('跳转到不允许的地址时拒绝', async () => {
    const response = await proxyFetch(`${origin}/redirect`, { checkTarget: onlyPublicPaths });
    expect(response.status).toBe(400);
});

test('源站返回 HTML 时按纯文本返回并禁止执行，且只允许浏览器缓存', async () => {
    const response = await proxyFetch(`${origin}/page`, { checkTarget: onlyPublicPaths });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(response.headers.get('Cache-Control')).toMatch(/^private/);
});

test('默认拦截本机地址', async () => {
    const response = await proxyFetch(`${origin}/page`);
    expect(response.status).toBe(400);
});

test('源站出错时不允许缓存，便于重试', async () => {
    const failing = http.createServer((req, res) => { res.writeHead(503); res.end('busy'); });
    await new Promise(resolve => failing.listen(0, '127.0.0.1', resolve));
    const response = await proxyFetch(`http://127.0.0.1:${failing.address().port}/x`, { checkTarget: () => true });
    failing.close();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
});

test('资源站接口结果（HTML 类型的 JSON，转为纯文本）只允许浏览器缓存 5 分钟', async () => {
    const request = new Request('http://site.test/proxy/' + encodeURIComponent(`${origin}/page`));
    const response = await handleRequest(request, {}, { serveAsset: () => new Response(null, { status: 404 }), proxyOptions: { checkTarget: onlyPublicPaths } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
});
