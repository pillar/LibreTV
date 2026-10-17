// Cloudflare Workers 入口，处理逻辑见 lib/handler.mjs（与 Node 版 server.mjs 共用）。
// 静态文件由 env.ASSETS 提供，哪些请求先经过 Worker 见 wrangler.jsonc 的 run_worker_first。
import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './lib/handler.mjs';

// 限流：登录每个 IP 每分钟 10 次（防止猜密码），代理每分钟 300 次（防止被当作通用代理滥用），与 server.mjs 一致。
// 可用变量 LOGIN_RATE_LIMIT / PROXY_RATE_LIMIT 调整（端到端测试中放宽登录次数）
const LIMITS = {
    login: { variable: 'LOGIN_RATE_LIMIT', limit: 10, period: 60 },
    proxy: { variable: 'PROXY_RATE_LIMIT', limit: 300, period: 60 }
};

/**
 * 限流计数：每个「用途 + 客户端」对应一个 Durable Object 实例，计数强一致。
 * （Cloudflare 的 Rate Limiting 绑定按机器近似计数，实测在线上连续 350 次请求都没有触发限制，因此不用它。）
 * hit 返回是否仍在限额内及本窗口结束时间（代理据此在 Worker 内暂时拒绝，见 backgroundLimiter）。
 */
export class RateLimiter extends DurableObject {
    hit(limit, periodMs) {
        const now = Date.now();
        const storage = this.ctx.storage.kv;
        let window = storage.get('window');
        if (!window || now - window.start >= periodMs) window = { start: now, count: 0 };
        window.count++;
        storage.put('window', window);
        return { success: window.count <= limit, resetAt: window.start + periodMs };
    }
}

function limitOf(env, name) {
    const { variable, limit, period } = LIMITS[name];
    return { limit: Number(env[variable]) || limit, periodMs: period * 1000 };
}

function stubOf(env, name, key) {
    return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(`${name}:${key}`));
}

// 登录：每次都等 Durable Object 计数结果，次数精确
function strictLimiter(env, name) {
    const { limit, periodMs } = limitOf(env, name);
    return {
        async limit({ key }) {
            return { success: (await stubOf(env, name, key).hit(limit, periodMs)).success };
        }
    };
}

// 代理（只对未命中服务端缓存、真正请求源站的请求计数，见 lib/handler.mjs 的 cachedProxyFetch）：每次都等 Durable Object 会让每个请求多花约 90ms（线上实测）。改为不等待：计数在后台（waitUntil）进行，
// 得知超限后，当前 Worker 实例在窗口结束前直接拒绝该客户端。
// 每个请求都计数（不在实例内攒批）：线上请求分散在许多实例上，攒批时多数实例迟迟得不到超限结果，实测几乎拦不住。
// 代价是超限后每个实例最多多放行正在计数中的少数请求。
const MAX_LOCAL_KEYS = 10_000;
const blockedUntil = new Map();   // key → 窗口结束时间

function backgroundLimiter(env, name, waitUntil) {
    const { limit, periodMs } = limitOf(env, name);
    return {
        async limit({ key }) {
            if ((blockedUntil.get(key) || 0) > Date.now()) return { success: false };
            waitUntil(stubOf(env, name, key).hit(limit, periodMs)
                .then(result => {
                    if (result.success) return;
                    blockedUntil.delete(key);
                    // Map 按插入顺序迭代，超出上限时淘汰最早记录的键
                    if (blockedUntil.size >= MAX_LOCAL_KEYS) blockedUntil.delete(blockedUntil.keys().next().value);
                    blockedUntil.set(key, result.resetAt);
                })
                .catch(error => console.error('限流计数失败:', error)));
            return { success: true };
        }
    };
}

export default {
    fetch(request, env, ctx) {
        const waitUntil = promise => ctx.waitUntil(promise);
        return handleRequest(request, {
            ...env,
            LOGIN_LIMITER: strictLimiter(env, 'login'),
            PROXY_LIMITER: backgroundLimiter(env, 'proxy', waitUntil)
        }, {
            serveAsset: req => env.ASSETS.fetch(req),
            clientIp: request.headers.get('CF-Connecting-IP') || '',
            waitUntil
        });
    }
};
