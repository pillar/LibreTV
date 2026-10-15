// 代理目标地址检查（Cloudflare 代理与 Node server.mjs 共用）：
// 只允许访问公网 http(s) 地址，拒绝本机、内网、链路本地（含云元数据 169.254.169.254）等地址，防止代理被用来探测内网。

const BLOCKED_HOST_SUFFIXES = ['localhost', '.local', '.internal', '.lan', '.home', '.intranet'];

function ipv4Parts(host) {
    const parts = host.split('.');
    if (parts.length !== 4 || !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
    return parts.map(Number);
}

function isPrivateIPv4([a, b]) {
    return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||   // 100.64.0.0/10 运营商级 NAT
        (a === 169 && b === 254) ||             // 链路本地 / 云元数据
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224;                               // 组播与保留地址
}

function isPrivateIPv6(host) {
    const ip = host.toLowerCase();
    if (ip === '::' || ip === '::1') return true;
    // IPv4 映射地址 ::ffff:a.b.c.d 或 ::ffff:7f00:1
    const mapped = ip.match(/^::ffff:(.+)$/);
    if (mapped) {
        const dotted = ipv4Parts(mapped[1]);
        if (dotted) return isPrivateIPv4(dotted);
        const hex = mapped[1].split(':');
        if (hex.length === 2) {
            const value = (parseInt(hex[0], 16) << 16) + parseInt(hex[1], 16);
            return isPrivateIPv4([(value >>> 24) & 255, (value >>> 16) & 255]);
        }
        return true;
    }
    return /^f[cd]/.test(ip) ||        // fc00::/7 唯一本地地址
        /^fe[89ab]/.test(ip) ||         // fe80::/10 链路本地
        /^ff/.test(ip);                 // 组播
}

/** IP 地址字符串（不带方括号）是否属于内网/保留地址 */
export function isPrivateAddress(address) {
    const v4 = ipv4Parts(address);
    if (v4) return isPrivateIPv4(v4);
    return address.includes(':') ? isPrivateIPv6(address) : false;
}

/** 代理目标 URL 是否允许访问 */
export function isAllowedTarget(urlString) {
    let url;
    try {
        url = new URL(urlString);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) return false;
    if (BLOCKED_HOST_SUFFIXES.some(suffix => host === suffix.replace(/^\./, '') || host.endsWith(suffix))) return false;
    // 纯数字主机名（如 2130706433 = 127.0.0.1）会被解析成 IP，直接拒绝
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
    return !isPrivateAddress(host);
}
