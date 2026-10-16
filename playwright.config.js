// 端到端测试：npm test（会先运行 npm run build）。之后分别启动 Node 版 server.mjs 与本地 Cloudflare Worker（wrangler dev），
// 两者共用 lib/handler.mjs，但静态文件、限流与运行环境不同，都需要验证。
// 数据源与豆瓣接口在测试中用模拟数据（见 tests/helpers.js），不依赖外部网站。
import { defineConfig } from '@playwright/test';

const NODE_PORT = 8099;
const WORKER_PORT = 8787;
const PASSWORDS = { PASSWORD: 'test-pass', ADMINPASSWORD: 'admin-pass' };

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        // 本地使用已安装的 Chrome；CI 中使用 Playwright 自带的 Chromium
        channel: process.env.CI ? undefined : 'chrome',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            // 前端功能与服务端接口：Node 版
            name: 'node',
            testIgnore: /rate-limit\.spec/,
            use: { baseURL: `http://localhost:${NODE_PORT}` }
        },
        {
            // 服务端接口：Cloudflare Worker（前端测试与 Node 版相同，不重复运行）
            name: 'worker',
            testMatch: /(auth|server)\.spec/,
            use: { baseURL: `http://localhost:${WORKER_PORT}` }
        },
        {
            // 登录限流会让同一 IP 一分钟内无法再登录，放在 Worker 其他测试之后单独运行
            name: 'worker-rate-limit',
            testMatch: /rate-limit\.spec/,
            dependencies: ['worker'],
            use: { baseURL: `http://localhost:${WORKER_PORT}` }
        }
    ],
    webServer: [
        {
            command: 'node server.mjs',
            url: `http://localhost:${NODE_PORT}`,
            reuseExistingServer: false,
            // 测试在一分钟内会登录多次，放宽 Node 版的登录限流
            env: { PORT: String(NODE_PORT), ...PASSWORDS, LOGIN_RATE_LIMIT: '1000' }
        },
        {
            command: `npx wrangler dev --port ${WORKER_PORT} --var PASSWORD:${PASSWORDS.PASSWORD} --var ADMINPASSWORD:${PASSWORDS.ADMINPASSWORD}`,
            url: `http://localhost:${WORKER_PORT}`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { PLAYANY_SKIP_BUILD: '1' }
        }
    ]
});
