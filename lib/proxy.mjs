// 代理请求（Cloudflare Worker 与 Node server.mjs 共用，见 lib/handler.mjs）。
// 网页端访问数据源接口、豆瓣接口和海报时会遇到跨域限制，因此经由本站转发；视频本身由播放器直连源站，不经过这里。

import { isAllowedTarget } from './target-guard.mjs';

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 10_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 代理响应不能被当成本站页面执行：只放行数据/媒体类型，其余按纯文本返回，并禁止脚本执行
const SAFE_CONTENT_TYPE = /^(application\/(json|vnd\.apple\.mpegurl|x-mpegurl|octet-stream)|video\/|audio\/|image\/(?!svg)|text\/plain)/i;

/** 从 /proxy/<编码后的地址> 中取出目标地址，格式不对时返回 null */
export function targetFromPath(pathname) {
    const encoded = pathname.slice('/proxy/'.length);
    if (!encoded) return null;
    try {
        return decodeURIComponent(encoded);
    } catch {
        return null;
    }
}

function upstreamHeaders(url) {
    const headers = { 'User-Agent': USER_AGENT, 'Accept': '*/*' };
    // 豆瓣图床校验 Referer，不带会返回 418
    if (/(^|\.)doubanio\.com$/.test(url.hostname)) headers.Referer = 'https://movie.douban.com/';
    return headers;
}

/**
 * 请求目标地址并返回可直接交给浏览器的响应。
 * checkTarget(url) 判断地址能否访问（Node 版额外校验域名解析结果），每次跳转前都会重新检查。
 * 地址不允许时返回 400；源站不可达或超时返回 502。
 */
export async function proxyFetch(target, { checkTarget = isAllowedTarget, timeout = DEFAULT_TIMEOUT, maxAge = 86400 } = {}) {
    let url = target;
    let response;
    for (let hop = 0; ; hop++) {
        if (!(await checkTarget(url))) return textResponse('不允许访问的地址', 400);
        try {
            response = await fetch(url, {
                headers: upstreamHeaders(new URL(url)),
                redirect: 'manual',
                signal: AbortSignal.timeout(timeout)
            });
        } catch (error) {
            return textResponse(`请求失败: ${error.name === 'TimeoutError' ? '源站响应超时' : error.message}`, 502);
        }
        const location = response.headers.get('Location');
        if (response.status < 300 || response.status >= 400 || !location) break;
        if (hop >= MAX_REDIRECTS) return textResponse('跳转次数过多', 502);
        url = new URL(location, url).toString();
    }

    const contentType = response.headers.get('Content-Type') || '';
    const headers = new Headers({
        'Content-Type': SAFE_CONTENT_TYPE.test(contentType) ? contentType : 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        // 只允许浏览器缓存：CDN 缓存的响应会绕过登录校验
        'Cache-Control': `private, max-age=${maxAge}`
    });
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
    }
    // fetch 已自动解压，原 Content-Length 对应压缩后的大小，不能沿用
    if (response.headers.get('Content-Encoding')) headers.delete('Content-Length');
    return new Response(response.body, { status: response.status, headers });
}

export function textResponse(text, status) {
    return new Response(text, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
}
