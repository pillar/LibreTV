// 端到端测试：npm test。会自动启动 server.mjs（带测试用密码），数据源与豆瓣接口在测试中用模拟数据。
import { defineConfig } from '@playwright/test';

const PORT = 8099;

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        // 本地使用已安装的 Chrome；CI 中使用 Playwright 自带的 Chromium
        channel: process.env.CI ? undefined : 'chrome',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node server.mjs',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        env: { PORT: String(PORT), PASSWORD: 'test-pass', ADMINPASSWORD: 'admin-pass' }
    }
});
