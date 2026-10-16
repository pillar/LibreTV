// Cloudflare Workers 入口，处理逻辑见 lib/handler.mjs（与 Node 版 server.mjs 共用）。
// 静态文件由 env.ASSETS 提供，哪些请求先经过 Worker 见 wrangler.jsonc 的 run_worker_first。
import { handleRequest } from './lib/handler.mjs';

export default {
    fetch(request, env, ctx) {
        return handleRequest(request, env, {
            serveAsset: req => env.ASSETS.fetch(req),
            clientIp: request.headers.get('CF-Connecting-IP') || '',
            waitUntil: promise => ctx.waitUntil(promise)
        });
    }
};
