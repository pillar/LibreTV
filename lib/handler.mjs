// 服务端请求处理（Cloudflare Worker 的 worker.js 与 Node 的 server.mjs 共用，两边行为保持一致）：
// 登录接口、代理（需登录、限流）、页面写入登录状态，其余请求交给静态文件。

import { authState, login, injectAuthState } from './auth.mjs';
import { proxyFetch, targetFromPath, textResponse } from './proxy.mjs';
import { rateLimitKey } from './rate-limit.mjs';

// 数据源接口与豆瓣接口的结果在服务端缓存 5 分钟（仅 Worker，见 cachedProxyFetch）
const API_CACHE_SECONDS = 300;
const CACHEABLE_TYPE = /^application\/json/i;
// 超过这个大小的结果不缓存，避免把大文件整个读进内存
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
// 登录请求体只有密码，超过这个大小直接拒绝
const MAX_LOGIN_BODY_BYTES = 4096;

// 页面的内容安全策略：脚本只能来自本站文件（页面中没有内联脚本和内联事件，见 js/actions.js）；
// 播放器需要直连各数据源的视频与图片，hls.js 使用 blob: Worker；样式允许内联（播放器会写入 style）
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    'img-src * data: blob:',
    'media-src * data: blob:',
    'connect-src *',
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
].join('; ');

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
async function allowed(limiter, clientIp) {
    if (!limiter) return true;
    const { success } = await limiter.limit({ key: rateLimitKey(clientIp) });
    return success;
}

/**
 * 读取请求体，最多 maxBytes 字节；超出时返回 null。
 * 先按 Content-Length 拒绝，分块传输时边读边计数，避免超大请求体占满内存。
 */
async function readBodyLimited(request, maxBytes) {
    if (Number(request.headers.get('Content-Length') || 0) > maxBytes) return null;
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    return new TextDecoder().decode(concatBytes(chunks, size));
}

function concatBytes(chunks, size) {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

// POST /auth/login  { password, type: 'user' | 'admin' }
async function handleLogin(request, env, clientIp) {
    if (!(await allowed(env.LOGIN_LIMITER, clientIp))) {
        return tooManyRequests('尝试次数过多，请稍后再试');
    }
    const text = await readBodyLimited(request, MAX_LOGIN_BODY_BYTES);
    if (text === null) return json({ ok: false, error: '请求过大' }, { status: 413 });
    let body;
    try {
        body = JSON.parse(text);
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
        response.headers.set('X-Proxy-Cache', 'HIT');
        return response;
    }

    const response = await proxyFetch(target, options);
    if (response.status !== 200 || !CACHEABLE_TYPE.test(response.headers.get('Content-Type') || '') || !response.body) return response;

    // 边读边计数：超过 MAX_CACHE_BYTES 时放弃缓存，已读部分与剩余内容照常返回
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
        if (size > MAX_CACHE_BYTES) {
            const body = new ReadableStream({
                start(controller) {
                    chunks.forEach(chunk => controller.enqueue(chunk));
                },
                async pull(controller) {
                    const next = await reader.read();
                    if (next.done) controller.close();
                    else controller.enqueue(next.value);
                },
                cancel(reason) {
                    return reader.cancel(reason);
                }
            });
            return new Response(body, response);
        }
    }

    const bytes = concatBytes(chunks, size);
    const stored = new Response(bytes, response);
    stored.headers.set('Cache-Control', `public, max-age=${API_CACHE_SECONDS}`);
    waitUntil(cache.put(key, stored));
    const fresh = new Response(bytes, response);
    fresh.headers.set('Cache-Control', `private, max-age=${API_CACHE_SECONDS}`);
    fresh.headers.set('X-Proxy-Cache', 'MISS');
    return fresh;
}

async function handleProxy(request, env, state, { clientIp, proxyOptions, waitUntil }) {
    // 代理只对已登录用户开放，避免被他人当作开放代理使用
    if (!state.authenticated) return textResponse('未登录', 401);
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse('不支持的请求方法', 405);
    if (!(await allowed(env.PROXY_LIMITER, clientIp))) return tooManyRequests('请求过于频繁，请稍后再试');

    const target = targetFromPath(new URL(request.url).pathname);
    if (!target) return textResponse('无效的代理请求。路径应为 /proxy/<经过编码的URL>', 400);
    return cachedProxyFetch(target, proxyOptions, waitUntil, new URL(request.url).origin);
}

/**
 * @param {Request} request
 * @param {object} env  PASSWORD、ADMINPASSWORD、SESSION_SECRET，以及可选的限流器 LOGIN_LIMITER、PROXY_LIMITER
 * @param {object} options
 *   serveAsset(request) 返回静态文件响应；clientIp 用于限流；
 *   proxyOptions 传给 proxyFetch 的选项（Node 版替换 fetch 以校验解析出的 IP）；waitUntil(promise) 延长请求生命周期
 */
export async function handleRequest(request, env, { serveAsset, clientIp = '', proxyOptions = {}, waitUntil = () => {} }) {
    const url = new URL(request.url);

    if (url.pathname === '/auth/login') {
        if (request.method !== 'POST') return textResponse('不支持的请求方法', 405);
        return handleLogin(request, env, clientIp);
    }

    const state = await authState(env, request.headers.get('Cookie'));
    if (url.pathname === '/auth/session') return json(state);
    if (url.pathname.startsWith('/proxy/')) return handleProxy(request, env, state, { clientIp, proxyOptions, waitUntil });

    // 搜索页地址 /s=关键词 使用首页
    let assetRequest = request;
    if (url.pathname.startsWith('/s=')) {
        assetRequest = new Request(new URL('/', url), request);
    }

    // 页面会写入当前登录状态，不能使用缓存的旧页面：页面地址（无扩展名或 .html）去掉条件请求头，
    // 静态文件仍可返回 304
    const lastSegment = url.pathname.split('/').pop();
    const isPagePath = !lastSegment.includes('.') || lastSegment.endsWith('.html');
    if (isPagePath) {
        assetRequest = new Request(assetRequest);
        assetRequest.headers.delete('If-None-Match');
        assetRequest.headers.delete('If-Modified-Since');
    }
    const response = await serveAsset(assetRequest);
    if (!(response.headers.get('Content-Type') || '').includes('text/html')) return response;

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.delete('ETag');
    headers.delete('Last-Modified');
    headers.delete('Content-Length');
    // 只有正常的 GET 页面需要写入登录状态；HEAD、跳转、304 等没有可改写的内容
    if (request.method !== 'GET' || response.status !== 200) {
        const body = [204, 205, 304].includes(response.status) ? null : response.body;
        return new Response(body, { status: response.status, statusText: response.statusText, headers });
    }
    return new Response(injectAuthState(await response.text(), state), {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}
