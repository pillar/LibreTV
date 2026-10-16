// Cloudflare Workers 入口，处理逻辑见 lib/handler.mjs（与 Node 版 server.mjs 共用）。
// 静态文件由 env.ASSETS 提供，哪些请求先经过 Worker 见 wrangler.jsonc 的 run_worker_first。
import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './lib/handler.mjs';

// 限流：登录每个 IP 每分钟 10 次（防止猜密码），代理每分钟 300 次（防止被当作通用代理滥用），与 server.mjs 一致
const LIMITS = {
    login: { limit: 10, period: 60 },
    proxy: { limit: 300, period: 60 }
};

/**
 * 限流计数：每个「用途 + 客户端」对应一个 Durable Object 实例，计数强一致。
 * （Cloudflare 的 Rate Limiting 绑定按机器近似计数，实测在线上连续 350 次请求都没有触发限制，因此不用它。）
 */
export class RateLimiter extends DurableObject {
    hit(limit, periodMs) {
        const now = Date.now();
        const storage = this.ctx.storage.kv;
        let window = storage.get('window');
        if (!window || now - window.start >= periodMs) window = { start: now, count: 0 };
        window.count++;
        storage.put('window', window);
        return window.count <= limit;
    }
}

function limiter(namespace, name) {
    const { limit, period } = LIMITS[name];
    return {
        async limit({ key }) {
            const stub = namespace.get(namespace.idFromName(`${name}:${key}`));
            return { success: await stub.hit(limit, period * 1000) };
        }
    };
}

export default {
    fetch(request, env, ctx) {
        return handleRequest(request, {
            ...env,
            LOGIN_LIMITER: limiter(env.RATE_LIMITER, 'login'),
            PROXY_LIMITER: limiter(env.RATE_LIMITER, 'proxy')
        }, {
            serveAsset: req => env.ASSETS.fetch(req),
            clientIp: request.headers.get('CF-Connecting-IP') || '',
            waitUntil: promise => ctx.waitUntil(promise)
        });
    }
};
