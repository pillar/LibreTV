// 播放器锁定、继续观看、配置导入白名单
import { test, expect } from '@playwright/test';
import { prepare, login, mockSources } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await prepare(page);
    await login(page);
});

test('播放器锁定后隐藏控件并拦截操作，解锁后恢复', async ({ page }) => {
    await page.goto('/player.html?url=' + encodeURIComponent('https://media.example/none.m3u8') + '&title=Demo');
    const player = page.locator('.art-video-player');
    await expect(page.locator('.art-lock-btn')).toBeAttached();

    await page.evaluate(() => setControlsLocked(true));
    await expect(player).toHaveClass(/art-locked/);
    await expect(page.locator('.art-bottom')).toBeHidden();
    await expect(page.locator('#lockToggle')).toHaveClass(/is-locked/);
    // 锁定时遮挡层接收点击，点击画面不会到达视频
    const layer = page.locator('.art-lock-layer');
    expect(await layer.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('auto');

    await page.click('#lockToggle');
    await expect(player).not.toHaveClass(/art-locked/);
    expect(await layer.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
});

test('首页「继续观看」展示观看历史，搜索时隐藏，清空后消失', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('viewingHistory', JSON.stringify([{
            title: '历史剧', url: 'player.html?url=' + encodeURIComponent('https://media.example/h/2.m3u8') + '&index=1',
            episodeIndex: 1, episodes: ['https://media.example/h/1.m3u8', 'https://media.example/h/2.m3u8'],
            playbackPosition: 600, duration: 2400, poster: '', sourceName: 'bfzy', timestamp: Date.now()
        }]));
    });
    await mockSources(page, { search: () => [] });
    await page.goto('/');
    const section = page.locator('#continueWatching');
    await expect(section).toBeVisible();
    await expect(section.locator('.cw-title')).toHaveText('历史剧');
    await expect(section.locator('.cw-meta')).toHaveText('第 2 集 · 剩 30 分钟');

    await page.fill('#searchInput', '任意');
    await page.click('button.search-go');
    await expect(section).toBeHidden();

    await page.evaluate(() => { resetToHome(); window.confirm = () => true; clearViewingHistory(); });
    await expect(section).toBeHidden();
});

test('导入配置只接受白名单内且格式正确的设置项', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
        applyImportedConfig({
            doubanEnabled: 'false',
            customAPIs: JSON.stringify([
                { name: '好的源', url: 'https://ok.example/api', detail: 'javascript:alert(1)' },
                { name: '坏的源', url: 'javascript:alert(2)' }
            ]),
            evilKey: 'x'
        });
        let rejected = false;
        try { applyImportedConfig({ doubanEnabled: '<script>' }); } catch { rejected = true; }
        return {
            douban: localStorage.getItem('doubanEnabled'),
            custom: JSON.parse(localStorage.getItem('customAPIs')),
            evil: localStorage.getItem('evilKey'),
            rejected
        };
    });
    expect(result.douban).toBe('false');
    expect(result.custom).toEqual([{ name: '好的源', url: 'https://ok.example/api', detail: '', isAdult: false }]);
    expect(result.evil).toBeNull();
    expect(result.rejected).toBe(true);
});
