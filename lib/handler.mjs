// 服务端请求处理（Cloudflare Worker 的 worker.js 与 Node 的 server.mjs 共用，两边行为保持一致）：
// 登录接口、代理（需登录、限流）、页面写入登录状态，其余请求交给静态文件。

import { authState, login, injectAuthState } from './auth.mjs';
import { proxyFetch, targetFromPath, textResponse } from './proxy.mjs';

// 数据源接口与豆瓣接口的结果在服务端缓存 5 分钟（仅 Worker，见 cachedProxyFetch）
const API_CACHE_SECONDS = 300;
const CACHEABLE_TYPE = /^(application\/json|text\/plain)/i;

function json(data, init = {}) {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(init.headers || {}) }
    });
}

function tooManyRequests(message) {
    return new Response(message, {
        status: 429,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' }
    });
}

/** 按客户端 IP 限流；没有配置限流器时不限制 */
async function allowed(limiter, key) {
    if (!limiter || !key) return true;
    const { success } = await limiter.limit({ key });
    return success;
}

// POST /auth/login  { password, type: 'user' | 'admin' }
async function handleLogin(request, env, clientIp) {
    if (!(await allowed(env.LOGIN_LIMITER, clientIp))) {
        return tooManyRequests('尝试次数过多，请稍后再试');
    }
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ ok: false, error: '请求格式错误' }, { status: 400 });
    }
    const kind = body && body.type === 'admin' ? 'admin' : 'user';
    const cookie = await login(env, kind, body && body.password, new URL(request.url).protocol === 'https:');
    if (!cookie) return json({ ok: false }, { status: 401 });
    return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}

/**
 * 接口类结果（JSON / 文本）在服务端短时缓存，同一关键词的重复搜索不必再请求所有数据源。
 * 缓存在登录校验之后读取，不会被未登录用户拿到；图片等其余内容只由浏览器缓存。
 */
async function cachedProxyFetch(target, options, waitUntil, origin) {
    const cache = globalThis.caches && globalThis.caches.default;
    if (!cache) return proxyFetch(target, options);

    // 缓存键使用本站地址：这个路径的请求总是先经过 Worker 的登录校验，缓存内容不会被直接访问到
    const key = new Request(`${origin}/__proxy-cache/${encodeURIComponent(target)}`);
    const hit = await cache.match(key);
    if (hit) {
        const response = new Response(hit.body, hit);
        response.headers.set('Cache-Control', `private, max-age=${API_CACHE_SECONDS}`);
        return response;
    }

    const response = await proxyFetch(target, options);
    if (response.status !== 200 || !CACHEABLE_TYPE.test(response.headers.get('Content-Type') || '')) return response;
    const body = await response.arrayBuffer();
    const stored = new Response(body, response);
    stored.headers.set('Cache-Control', `public, max-age=${API_CACHE_SECONDS}`);
    waitUntil(cache.put(key, stored));
    const fresh = new Response(body, response);
    fresh.headers.set('Cache-Control', `private, max-age=${API_CACHE_SECONDS}`);
    return fresh;
}

async function handleProxy(request, env, state, { clientIp, checkTarget, waitUntil }) {
    // 代理只对已登录用户开放，避免被他人当作开放代理使用
    if (!state.authenticated) return textResponse('未登录', 401);
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse('不支持的请求方法', 405);
    if (!(await allowed(env.PROXY_LIMITER, clientIp))) return tooManyRequests('请求过于频繁，请稍后再试');

    const target = targetFromPath(new URL(request.url).pathname);
    if (!target) return textResponse('无效的代理请求。路径应为 /proxy/<经过编码的URL>', 400);
    return cachedProxyFetch(target, { checkTarget }, waitUntil, new URL(request.url).origin);
}

/**
 * @param {Request} request
 * @param {object} env  PASSWORD、ADMINPASSWORD、SESSION_SECRET，以及可选的限流器 LOGIN_LIMITER、PROXY_LIMITER
 * @param {object} options
 *   serveAsset(request) 返回静态文件响应；clientIp 用于限流；
 *   checkTarget(url) 代理目标检查（默认只检查地址本身）；waitUntil(promise) 延长请求生命周期
 */
export async function handleRequest(request, env, { serveAsset, clientIp = '', checkTarget, waitUntil = () => {} }) {
    const url = new URL(request.url);

    if (url.pathname === '/auth/login') {
        if (request.method !== 'POST') return textResponse('不支持的请求方法', 405);
        return handleLogin(request, env, clientIp);
    }

    const state = await authState(env, request.headers.get('Cookie'));
    if (url.pathname === '/auth/session') return json(state);
    if (url.pathname.startsWith('/proxy/')) return handleProxy(request, env, state, { clientIp, checkTarget, waitUntil });

    // 搜索页地址 /s=关键词 使用首页
    let assetRequest = request;
    if (url.pathname.startsWith('/s=')) {
        assetRequest = new Request(new URL('/', url), request);
    }

    // 页面会写入当前登录状态，不能使用缓存的旧页面：去掉条件请求头，并禁止缓存
    const wantsPage = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
    if (wantsPage) {
        assetRequest = new Request(assetRequest);
        assetRequest.headers.delete('If-None-Match');
        assetRequest.headers.delete('If-Modified-Since');
    }
    const response = await serveAsset(assetRequest);
    if (!(response.headers.get('Content-Type') || '').includes('text/html')) return response;

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.delete('ETag');
    headers.delete('Content-Length');
    return new Response(injectAuthState(await response.text(), state), {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}
