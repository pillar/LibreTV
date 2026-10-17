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
 * hit 一次可以计入多次请求（代理请求在 Worker 内先累计，见 batchedLimiter），返回是否仍在限额内及本窗口结束时间。
 */
export class RateLimiter extends DurableObject {
    hit(limit, periodMs, count = 1) {
        const now = Date.now();
        const storage = this.ctx.storage.kv;
        let window = storage.get('window');
        if (!window || now - window.start >= periodMs) window = { start: now, count: 0 };
        window.count += count;
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

// 代理：每次都等 Durable Object 会让每个请求多花约 90ms（线上实测），且每个请求都计一次 Durable Object 调用。
// 改为在当前 Worker 实例内累计，每 PROXY_BATCH 次在后台（waitUntil）汇总一次；得知超限后，本实例在窗口结束前直接拒绝。
// 代价是超限后每个 Worker 实例最多多放行约 PROXY_BATCH 次请求，对防止被当作通用代理滥用没有影响。
const PROXY_BATCH = 10;
const MAX_LOCAL_KEYS = 10_000;
const localCounts = new Map();   // key → { pending, blockedUntil }

function batchedLimiter(env, name, waitUntil) {
    const { limit, periodMs } = limitOf(env, name);
    return {
        async limit({ key }) {
            const now = Date.now();
            let entry = localCounts.get(key);
            if (!entry) {
                if (localCounts.size >= MAX_LOCAL_KEYS) localCounts.clear();
                entry = { pending: 0, blockedUntil: 0 };
                localCounts.set(key, entry);
            }
            if (entry.blockedUntil > now) return { success: false };
            entry.pending++;
            if (entry.pending >= PROXY_BATCH) {
                const count = entry.pending;
                entry.pending = 0;
                waitUntil(stubOf(env, name, key).hit(limit, periodMs, count)
                    .then(result => {
                        if (!result.success) entry.blockedUntil = result.resetAt;
                    })
                    .catch(error => console.error('限流计数失败:', error)));
            }
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
            PROXY_LIMITER: batchedLimiter(env, 'proxy', waitUntil)
        }, {
            serveAsset: req => env.ASSETS.fetch(req),
            clientIp: request.headers.get('CF-Connecting-IP') || '',
            waitUntil
        });
    }
};
