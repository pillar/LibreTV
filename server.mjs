import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { authState, login, injectAuthState } from './lib/auth.mjs';
import { isAllowedTarget, isPrivateAddress } from './lib/target-guard.mjs';
import { lookup } from 'dns/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  adminpassword: process.env.ADMINPASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 会话校验所需的配置（与 Cloudflare 中间件共用 lib/auth.mjs）
const authEnv = {
  PASSWORD: config.password,
  ADMINPASSWORD: config.adminpassword,
  SESSION_SECRET: process.env.SESSION_SECRET || ''
};

// 页面写入当前登录状态；页面因人而异，禁止缓存
async function renderPage(filePath, req, res) {
  const content = fs.readFileSync(filePath, 'utf8');
  res.set('Cache-Control', 'no-store');
  return injectAuthState(content, await authState(authEnv, req.headers.cookie));
}

// POST /auth/login  { password, type: 'user' | 'admin' }
app.post('/auth/login', express.json(), async (req, res) => {
  const kind = req.body && req.body.type === 'admin' ? 'admin' : 'user';
  const cookie = await login(authEnv, kind, req.body && req.body.password, req.secure);
  if (!cookie) {
    // 失败时稍作延迟，降低暴力猜测速度
    await new Promise(resolve => setTimeout(resolve, 600));
    return res.status(401).json({ ok: false });
  }
  res.set('Set-Cookie', cookie).set('Cache-Control', 'no-store').json({ ok: true });
});

app.get('/auth/session', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await authState(authEnv, req.headers.cookie));
});

// 代理只对已登录用户开放，避免被他人当作开放代理使用
app.use('/proxy', async (req, res, next) => {
  const state = await authState(authEnv, req.headers.cookie);
  if (!state.authenticated) return res.status(401).set('Cache-Control', 'no-store').send('未登录');
  next();
});

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    res.send(await renderPage(filePath, req, res));
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    res.send(await renderPage(filePath, req, res));
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

// 代理目标检查：地址本身（lib/target-guard.mjs）+ 域名解析结果都不能是内网地址，防止通过代理访问内网
async function isSafeTarget(urlString) {
  if (!isAllowedTarget(urlString)) return false;
  try {
    const addresses = await lookup(new URL(urlString).hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

// 代理响应不能被当成本站页面执行：只放行数据/媒体类型，其余按纯文本返回，并禁止脚本执行
const SAFE_PROXY_CONTENT_TYPE = /^(application\/(json|vnd\.apple\.mpegurl|x-mpegurl|octet-stream)|video\/|audio\/|image\/(?!svg)|text\/plain)/i;

function setSafeProxyHeaders(res, contentType) {
  res.set({
    'Content-Type': SAFE_PROXY_CONTENT_TYPE.test(contentType || '') ? contentType : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox'
  });
}

// 代理路由
app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    const encodedUrl = req.params.encodedUrl;
    const targetUrl = decodeURIComponent(encodedUrl);

    // 安全验证
    if (!(await isSafeTarget(targetUrl))) {
      return res.status(400).send('不允许访问的地址');
    }

    log(`代理请求: ${targetUrl}`);

    // 添加请求超时和重试逻辑
    const maxRetries = config.maxRetries;
    let retries = 0;
    
    const makeRequest = async () => {
      try {
        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: config.timeout,
          maxRedirects: 5,
          // 每次跳转前重新检查目标地址（跳转目标不能是内网）
          beforeRedirect: (options) => {
            const next = `${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ''}${options.path || ''}`;
            if (!isAllowedTarget(next)) throw new Error('跳转到了不允许访问的地址');
          },
          headers: {
            'User-Agent': config.userAgent,
            // 豆瓣图床校验 Referer，不带会返回 418
            ...(/(^|\.)doubanio\.com$/.test(new URL(targetUrl).hostname) ? { Referer: 'https://movie.douban.com/' } : {})
          }
        });
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          log(`重试请求 (${retries}/${maxRetries}): ${targetUrl}`);
          return makeRequest();
        }
        throw error;
      }
    };

    const response = await makeRequest();

    // 转发响应头（过滤敏感头）
    const headers = { ...response.headers };
    const sensitiveHeaders = (
      process.env.FILTERED_HEADERS || 
      'content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin'
    ).split(',');
    
    sensitiveHeaders.forEach(header => delete headers[header]);
    res.set(headers);
    setSafeProxyHeaders(res, response.headers['content-type']);

    // 管道传输响应流
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error.message);
    if (error.response) {
      res.status(error.response.status || 500);
      setSafeProxyHeaders(res, error.response.headers['content-type']);
      error.response.data.pipe(res);
    } else {
      res.status(500).send(`请求失败: ${error.message}`);
    }
  }
});

app.use(express.static(path.join(__dirname), {
  maxAge: config.cacheMaxAge
}));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);
  if (config.password !== '') {
    console.log('用户登录密码已设置');
  }
  if (config.adminpassword !== '') {
    console.log('管理员登录密码已设置');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '', adminpassword: config.adminpassword? '******' : '' });
  }
});
