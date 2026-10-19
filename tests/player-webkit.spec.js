// WebKit（iPhone App 与 Safari）专有的播放页行为：切换剧集时销毁并重建播放器（js/player.js 的 isWebkit 分支）
import { test, expect } from '@playwright/test';
import { prepare, login } from './helpers.js';

test('网页全屏时切换下一集：只剩新播放器，仍保持网页全屏', async ({ page }) => {
    await prepare(page);
    await login(page);
    await page.route('https://media.example/**', route => route.fulfill({ status: 404, body: '' }));
    await page.addInitScript(() => sessionStorage.setItem('playContext:bfzy:p1', JSON.stringify({
        title: '全屏测试', episodes: ['https://media.example/p1/1.m3u8', 'https://media.example/p1/2.m3u8']
    })));
    await page.goto('/player.html?source=bfzy&id=p1&index=0&title=T&url=' + encodeURIComponent('https://media.example/p1/1.m3u8'));
    await expect(page.locator('.art-video-player')).toHaveCount(1);
    expect(await page.evaluate(() => isWebkit)).toBe(true);

    await page.evaluate(() => { art.fullscreenWeb = true; });
    await page.evaluate(() => playNextEpisode());
    await page.waitForTimeout(1000);
    // 修复前：旧播放器留在 body 下的全屏层，盖住新播放器
    await expect(page.locator('.art-video-player')).toHaveCount(1);
    expect(await page.evaluate(() => ({ index: currentEpisodeIndex, fullscreenWeb: art.fullscreenWeb }))).toEqual({ index: 1, fullscreenWeb: true });
});
