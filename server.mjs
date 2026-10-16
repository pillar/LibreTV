// Node 版服务（Docker / 本地运行）：请求处理与 Cloudflare Worker 共用 lib/handler.mjs，静态文件来自 npm run build 生成的 dist/。
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { handleRequest } from './lib/handler.mjs';
import { isAllowedTarget, isPrivateAddress } from './lib/target-guard.mjs';
import { createRateLimiter } from './lib/rate-limit.mjs';

dotenv.config();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 8080);
// 部署在反向代理之后时设置 TRUST_PROXY=true，限流按 X-Forwarded-For 中的客户端地址计算
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const env = {
    PASSWORD: process.env.PASSWORD || '',
    ADMINPASSWORD: process.env.ADMINPASSWORD || '',
    SESSION_SECRET: process.env.SESSION_SECRET || '',
    // 与 wrangler.jsonc 中 Worker 的限流配置一致：登录每分钟 10 次、代理每分钟 300 次（按客户端 IP）
    LOGIN_LIMITER: createRateLimiter({ limit: Number(process.env.LOGIN_RATE_LIMIT || 10), period: 60 }),
    PROXY_LIMITER: createRateLimiter({ limit: Number(process.env.PROXY_RATE_LIMIT || 300), period: 60 })
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2'
};

// 代理目标检查：地址本身（lib/target-guard.mjs）+ 域名解析结果都不能是内网地址
async function isSafeTarget(urlString) {
    if (!isAllowedTarget(urlString)) return false;
    try {
        const addresses = await lookup(new URL(urlString).hostname, { all: true });
        return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
    } catch {
        return false;
    }
}

async function findFile(pathname) {
    let relative;
    try {
        relative = decodeURIComponent(pathname);
    } catch {
        return null;
    }
    // 与 Cloudflare 静态资源一致：/ → index.html，/player → player.html
    const candidates = relative.endsWith('/') ? [relative + 'index.html'] : [relative, relative + '.html'];
    for (const candidate of candidates) {
        const file = path.join(ROOT, candidate);
        if (!file.startsWith(ROOT + path.sep)) return null;
        try {
            const info = await stat(file);
            if (info.isFile()) return { file, info };
        } catch {
            // 继续尝试下一个
        }
    }
    return null;
}

async function serveAsset(request) {
    const { pathname } = new URL(request.url);
    const found = await findFile(pathname);
    if (!found) return new Response('页面未找到', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    const lastModified = found.info.mtime.toUTCString();
    const headers = new Headers({
        'Content-Type': MIME_TYPES[path.extname(found.file).toLowerCase()] || 'application/octet-stream',
        'Last-Modified': lastModified,
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    if (request.headers.get('If-Modified-Since') === lastModified) return new Response(null, { status: 304, headers });
    headers.set('Content-Length', String(found.info.size));
    const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(found.file));
    return new Response(body, { headers });
}

function clientIpOf(req) {
    const forwarded = TRUST_PROXY && req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || '';
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') url.protocol = 'https:';
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const request = new Request(url, {
            method: req.method,
            headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
            body: hasBody ? Readable.toWeb(req) : undefined,
            duplex: hasBody ? 'half' : undefined
        });
        const response = await handleRequest(request, env, {
            serveAsset,
            clientIp: clientIpOf(req),
            checkTarget: isSafeTarget
        });

        const headers = {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
            ...Object.fromEntries(response.headers)
        };
        // Set-Cookie 可能有多个，需要单独取出
        const cookies = response.headers.getSetCookie();
        if (cookies.length) headers['set-cookie'] = cookies;
        res.writeHead(response.status, headers);
        if (response.body && req.method !== 'HEAD') {
            Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
        } else {
            res.end();
        }
    } catch (error) {
        console.error('请求处理错误:', error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('服务器内部错误');
    }
});

server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    if (env.PASSWORD) console.log('用户登录密码已设置');
    if (env.ADMINPASSWORD) console.log('管理员登录密码已设置');
});
