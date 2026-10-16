// Node 版服务（Docker / 本地运行）：请求处理与 Cloudflare Worker 共用 lib/handler.mjs，静态文件来自 npm run build 生成的 dist/。
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import dns from 'node:dns';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Agent, fetch as undiciFetch } from 'undici';
import { handleRequest } from './lib/handler.mjs';
import { isPrivateAddress } from './lib/target-guard.mjs';
import { createRateLimiter } from './lib/rate-limit.mjs';

dotenv.config();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 8080);
// 部署在反向代理之后时设置 TRUST_PROXY=true，限流按 X-Forwarded-For 中的客户端地址计算
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
// 请求体只有登录接口会用到，超过这个大小直接拒绝
const MAX_BODY_BYTES = 16 * 1024;

const env = {
    PASSWORD: process.env.PASSWORD || '',
    ADMINPASSWORD: process.env.ADMINPASSWORD || '',
    SESSION_SECRET: process.env.SESSION_SECRET || '',
    // 与 Worker（worker.js 的 LIMITS）一致：登录每分钟 10 次、代理每分钟 300 次（按客户端 IP）
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

// 代理连接内网检查：地址本身由 lib/target-guard.mjs 检查；域名在建立连接时校验实际解析出的 IP，
// 避免先校验、再由 fetch 重新解析时被 DNS 重绑定指向内网
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error);
        if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
            return callback(Object.assign(new Error('不允许访问的地址'), { code: 'EBLOCKED' }));
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
}

const proxyAgent = new Agent({ connect: { lookup: safeLookup } });
const proxyOptions = { fetch: (url, init) => undiciFetch(url, { ...init, dispatcher: proxyAgent }) };

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

// 反向代理会把真实客户端地址追加到 X-Forwarded-For 末尾，前面的内容可由客户端伪造，只取最后一项
function clientIpOf(req) {
    const forwarded = TRUST_PROXY && req.headers['x-forwarded-for'];
    return (forwarded ? forwarded.split(',').pop().trim() : req.socket.remoteAddress) || '';
}

/** 读取请求体，超过 MAX_BODY_BYTES 时返回 null */
async function readBody(req) {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') url.protocol = 'https:';
        let body;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            body = await readBody(req);
            if (body === null) {
                res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
                return res.end('请求过大');
            }
        }
        const request = new Request(url, {
            method: req.method,
            headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
            body
        });
        const response = await handleRequest(request, env, {
            serveAsset,
            clientIp: clientIpOf(req),
            proxyOptions
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
            // 客户端中途断开时 pipeline 会同时关闭源流（本地文件或上游连接）
            await pipeline(Readable.fromWeb(response.body), res).catch(() => {});
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
