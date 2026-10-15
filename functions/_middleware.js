import { authState, login, injectAuthState } from '../lib/auth.mjs';

// 只通过自定义域名对外提供服务：项目默认地址 <项目>.pages.dev 301 跳转过去；
// 各次部署和分支的预览地址（<hash>.<项目>.pages.dev）不受影响
const CANONICAL_HOST = 'tv.playany.app';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(init.headers || {}) }
  });
}

// POST /auth/login  { password, type: 'user' | 'admin' }
async function handleLogin(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  const kind = body.type === 'admin' ? 'admin' : 'user';
  const cookie = await login(env, kind, body.password, new URL(request.url).protocol === 'https:');
  if (!cookie) {
    // 失败时稍作延迟，降低暴力猜测速度
    await new Promise(resolve => setTimeout(resolve, 600));
    return json({ ok: false }, { status: 401 });
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev') && url.hostname.split('.').length === 3) {
    url.protocol = 'https:';
    url.hostname = CANONICAL_HOST;
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  const state = await authState(env, request.headers.get('Cookie'));
  if (url.pathname === '/auth/session') {
    return json(state);
  }

  // 代理只对已登录用户开放，避免被他人当作开放代理使用
  if (url.pathname.startsWith('/proxy/') && !state.authenticated) {
    return new Response('未登录', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  // 页面会写入当前登录状态，不能使用缓存的旧页面：去掉条件请求头，并禁止缓存
  const isPage = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
  let upstream = request;
  if (isPage) {
    upstream = new Request(request);
    upstream.headers.delete('If-None-Match');
    upstream.headers.delete('If-Modified-Since');
  }
  const response = await next(upstream);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.delete('ETag');
  headers.delete('Content-Length');
  return new Response(injectAuthState(await response.text(), state), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
