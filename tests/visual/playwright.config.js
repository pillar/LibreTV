// 外观对比：npm run visual [-- <git 版本>]，由 scripts/visual-diff.mjs 调用，不在 npm test 中运行。
// 同一台机器上先用指定版本截图作为基准，再用当前代码截图逐像素比较（容差为 0），用于验证样式重构「外观不变」。
// 页面由 scripts/visual-diff.mjs 启动的 server.mjs 提供（端口 VISUAL_PORT）；VISUAL_OUT 为基准截图与差异图的输出目录。
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const PORT = process.env.VISUAL_PORT || 8199;
const OUT = process.env.VISUAL_OUT || 'visual-results';

export default defineConfig({
    testDir: '.',
    timeout: 60_000,
    workers: 4,
    reporter: 'list',
    outputDir: join(OUT, 'diff'),
    snapshotPathTemplate: join(OUT, 'baseline', '{arg}{ext}'),
    // threshold 默认 0.2，会放过细微的颜色变化（见 CORRECTIONS.md），这里每个像素都严格比较；
    // 允许最多 10 个像素不同：毛玻璃（backdrop-filter）边缘偶尔有 1 个像素不同，真正的样式变化影响的像素远多于此
    expect: { toHaveScreenshot: { maxDiffPixels: 10, threshold: 0, animations: 'disabled', caret: 'hide' } },
    use: { baseURL: `http://localhost:${PORT}`, channel: process.env.CI ? undefined : 'chrome' },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
        { name: 'mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
    ]
});
