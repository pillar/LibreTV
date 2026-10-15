// 服务端会话（Cloudflare Pages 中间件与 Node server.mjs 共用）。
// 密码只在服务端校验；校验通过后签发 HMAC 签名的 HttpOnly Cookie，页面和 /proxy/ 都据此判断是否已登录。
// 签名密钥默认由 PASSWORD / ADMINPASSWORD 派生，修改密码后所有已登录设备自动失效；也可单独设置 SESSION_SECRET。

const encoder = new TextEncoder();
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const COOKIE_NAMES = { user: 'pa_session', admin: 'pa_admin' };

function toHex(buffer) {
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, data) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

function sameString(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function secretOf(env) {
    return env.SESSION_SECRET || `playany|${env.PASSWORD || ''}|${env.ADMINPASSWORD || ''}`;
}

function passwordOf(env, kind) {
    return (kind === 'admin' ? env.ADMINPASSWORD : env.PASSWORD) || '';
}

function readCookie(header, name) {
    const match = (header || '').split(/;\s*/).find(part => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

async function verifyToken(env, kind, token) {
    const [expires, signature] = (token || '').split('.');
    if (!expires || !signature || Number(expires) < Date.now()) return false;
    return sameString(signature, await hmac(secretOf(env), `${kind}.${expires}`));
}

/** 当前请求的登录状态，会写入页面供前端判断是否需要输入密码 */
export async function authState(env, cookieHeader) {
    const passwordRequired = Boolean(env.PASSWORD);
    const adminRequired = Boolean(env.ADMINPASSWORD);
    return {
        passwordRequired,
        authenticated: !passwordRequired || await verifyToken(env, 'user', readCookie(cookieHeader, COOKIE_NAMES.user)),
        adminRequired,
        admin: !adminRequired || await verifyToken(env, 'admin', readCookie(cookieHeader, COOKIE_NAMES.admin))
    };
}

/**
 * 校验密码，成功时返回要设置的 Set-Cookie 值，失败返回 null。
 * 通过比较两个 HMAC 结果避免按字符提前退出带来的时序差异。
 */
export async function login(env, kind, password, secure) {
    const expected = passwordOf(env, kind);
    if (!expected || typeof password !== 'string') return null;
    const secret = secretOf(env);
    const [given, wanted] = await Promise.all([hmac(secret, `pw.${password}`), hmac(secret, `pw.${expected}`)]);
    if (!sameString(given, wanted)) return null;

    const expires = Date.now() + MAX_AGE_SECONDS * 1000;
    const token = `${expires}.${await hmac(secret, `${kind}.${expires}`)}`;
    return `${COOKIE_NAMES[kind]}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 把登录状态写入页面（替换 HTML 中的占位符 /*AUTH*\/null） */
export function injectAuthState(html, state) {
    return html.replace('/*AUTH*/null', JSON.stringify(state));
}
