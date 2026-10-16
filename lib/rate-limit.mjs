// 限流（Cloudflare Worker 与 Node server.mjs 共用的部分）。

const MAX_KEYS = 10_000;

/**
 * 限流计数的键：IPv4 按单个地址；IPv6 按 /64 网段（同一用户通常拥有整个 /64，按单个地址计数可被轻易绕过）。
 * 拿不到客户端地址时归入同一个键，宁可误伤也不放行。
 */
export function rateLimitKey(ip) {
    if (!ip) return 'unknown';
    const address = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
    if (!address.includes(':')) return address;
    const [head, tail = ''] = address.toLowerCase().split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const groups = address.includes('::')
        ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill('0'), ...tailParts]
        : headParts;
    return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/**
 * Node 版的限流器（固定时间窗口，进程内计数），接口与 Cloudflare Workers 的 Rate Limiting 绑定一致：
 * limiter.limit({ key }) → { success }。最多记录 MAX_KEYS 个键，超出时淘汰最早的。
 */
export function createRateLimiter({ limit, period }) {
    const windows = new Map();
    return {
        async limit({ key }) {
            const now = Date.now();
            let entry = windows.get(key);
            if (!entry || now - entry.start >= period * 1000) {
                windows.delete(key);
                entry = { start: now, count: 0 };
                windows.set(key, entry);
                // Map 按插入顺序迭代，第一个即最早的窗口
                if (windows.size > MAX_KEYS) windows.delete(windows.keys().next().value);
            }
            entry.count++;
            return { success: entry.count <= limit };
        }
    };
}
