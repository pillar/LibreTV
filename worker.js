// Cloudflare Workers 入口：复用 functions/ 下原 Pages Functions 的处理逻辑。
// 所有请求先经过 _middleware.js（登录、代理鉴权、页面注入登录状态），
// /proxy/* 交给代理处理，其余由静态资源（env.ASSETS，见 wrangler.jsonc 与 .assetsignore）返回。
import { onRequest as middleware } from './functions/_middleware.js';
import { onRequest as proxy, onOptions as proxyOptions } from './functions/proxy/[[path]].js';

export default {
    async fetch(request, env, ctx) {
        const waitUntil = promise => ctx.waitUntil(promise);
        const next = async (input = request) => {
            const req = input instanceof Request ? input : new Request(input, request);
            if (new URL(req.url).pathname.startsWith('/proxy/')) {
                const context = { request: req, env, waitUntil, params: {}, next: () => env.ASSETS.fetch(req) };
                return req.method === 'OPTIONS' ? proxyOptions(context) : proxy(context);
            }
            return env.ASSETS.fetch(req);
        };
        return middleware({ request, env, waitUntil, params: {}, next });
    }
};
