// Node 版的简单限流器（固定时间窗口，进程内计数），接口与 Cloudflare Workers 的 Rate Limiting 绑定一致：
// limiter.limit({ key }) → { success }。Worker 上使用 wrangler.jsonc 中配置的绑定。

export function createRateLimiter({ limit, period }) {
    const windows = new Map();
    return {
        async limit({ key }) {
            const now = Date.now();
            let entry = windows.get(key);
            if (!entry || now - entry.start >= period * 1000) {
                entry = { start: now, count: 0 };
                windows.set(key, entry);
                // 顺带清理过期的计数，避免长期运行时无限增长
                if (windows.size > 10_000) {
                    for (const [k, v] of windows) if (now - v.start >= period * 1000) windows.delete(k);
                }
            }
            entry.count++;
            return { success: entry.count <= limit };
        }
    };
}
