// 端到端测试：npm test（会先运行 npm run build）。之后分别启动 Node 版 server.mjs 与本地 Cloudflare Worker（wrangler dev），
// 两者共用 lib/handler.mjs，但静态文件、限流与运行环境不同，都需要验证。
// 数据源与豆瓣接口在测试中用模拟数据（见 tests/helpers.js），不依赖外部网站。
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NODE_PORT = 8099;
// 本地使用已安装的 Chrome；CI 中使用 Playwright 自带的 Chromium
const CHANNEL = process.env.CI ? undefined : 'chrome';
const WORKER_PORT = 8787;
const PASSWORDS = { PASSWORD: 'test-pass', ADMINPASSWORD: 'admin-pass' };
// 测试在一分钟内会多次登录，放宽登录限流：Node 版运行全部测试，几乎不限；Worker 只运行接口测试，
// 保留较低的上限，由 rate-limit.spec.js 验证限流本身
const TEST_LOGIN_LIMIT = 20;
// wrangler dev 默认把 Durable Object（限流计数）保存在 .wrangler/state，每次测试用新的目录，避免上次的计数残留
const WORKER_STATE = process.env.PLAYANY_WORKER_STATE || (process.env.PLAYANY_WORKER_STATE = mkdtempSync(join(tmpdir(), 'playany-wrangler-')));

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        trace: 'retain-on-failure'
    },
    projects: [
        {
            // 前端功能与服务端接口：Node 版
            name: 'node',
            testIgnore: [/rate-limit\.spec/, /visual\//, /webkit\.spec/],
            use: { channel: CHANNEL, baseURL: `http://localhost:${NODE_PORT}` }
        },
        {
            // iPhone（WebKit）专有的代码路径，例如切换剧集时重建播放器
            name: 'webkit',
            testMatch: /webkit\.spec/,
            use: { browserName: 'webkit', baseURL: `http://localhost:${NODE_PORT}` }
        },
        {
            // 服务端接口：Cloudflare Worker（前端测试与 Node 版相同，不重复运行）
            name: 'worker',
            testMatch: /(auth|server)\.spec/,
            use: { channel: CHANNEL, baseURL: `http://localhost:${WORKER_PORT}` }
        },
        {
            // 登录限流会让同一 IP 一分钟内无法再登录，放在 Worker 其他测试之后单独运行
            name: 'worker-rate-limit',
            testMatch: /rate-limit\.spec/,
            dependencies: ['worker'],
            use: { channel: CHANNEL, baseURL: `http://localhost:${WORKER_PORT}` }
        }
    ],
    webServer: [
        {
            command: 'node server.mjs',
            url: `http://localhost:${NODE_PORT}`,
            reuseExistingServer: false,
            env: { PORT: String(NODE_PORT), ...PASSWORDS, LOGIN_RATE_LIMIT: '1000' }
        },
        {
            command: `npx wrangler dev --port ${WORKER_PORT} --persist-to ${WORKER_STATE} --var PASSWORD:${PASSWORDS.PASSWORD} --var ADMINPASSWORD:${PASSWORDS.ADMINPASSWORD} --var LOGIN_RATE_LIMIT:${TEST_LOGIN_LIMIT}`,
            url: `http://localhost:${WORKER_PORT}`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { PLAYANY_SKIP_BUILD: '1' }
        }
    ]
});
