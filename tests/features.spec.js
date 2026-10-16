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

test('豆瓣接口偶发失败时自动重试，海报加载后淡入；持续失败时可手动重试', async ({ page, context }) => {
    await prepare(page, { douban: true });
    let failuresLeft = 2;
    let calls = 0;
    await page.route('**/proxy/**', route => {
        const target = decodeURIComponent(route.request().url().split('/proxy/')[1] || '');
        const url = new URL(target);
        if (url.pathname === '/j/search_subjects') {
            calls++;
            if (failuresLeft-- > 0) return route.fulfill({ status: 502, body: 'bad gateway' });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ subjects: [
                { title: '豆瓣片', rate: '8.8', url: 'https://movie.douban.com/subject/1/', cover: 'https://img1.doubanio.com/p1.jpg' }
            ] }) });
        }
        if (url.hostname.endsWith('doubanio.com')) {
            return route.fulfill({ path: 'image/icon-512.png', contentType: 'image/png' });
        }
        if (url.pathname === '/j/search_tags') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tags: ['热门'] }) });
        }
        return route.fulfill({ status: 404, body: 'not mocked' });
    });
    await context.route('https://api.allorigins.win/**', route => route.abort());
    await page.goto('/');

    const cover = page.locator('#douban-results .douban-cover');
    await expect(cover).toHaveCount(1);
    await expect(cover).toHaveClass(/is-loaded/);
    expect(calls).toBe(3);

    // 3 次都失败：显示重试按钮，点击后重新请求
    failuresLeft = 3;
    await page.evaluate(() => renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart));
    const retry = page.locator('#douban-results .douban-retry');
    await expect(retry).toBeVisible({ timeout: 15000 });
    await retry.click();
    await expect(page.locator('#douban-results .douban-cover')).toHaveClass(/is-loaded/);
});

test('豆瓣海报加载失败后自动重试', async ({ page }) => {
    await prepare(page, { douban: true });
    let imageFailures = 1;
    await page.route('**/proxy/**', route => {
        const url = new URL(decodeURIComponent(route.request().url().split('/proxy/')[1] || ''));
        if (url.pathname === '/j/search_subjects') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ subjects: [
                { title: '豆瓣片', rate: '8.8', url: 'https://movie.douban.com/subject/1/', cover: 'https://img1.doubanio.com/p1.jpg' }
            ] }) });
        }
        if (url.hostname.endsWith('doubanio.com')) {
            if (imageFailures-- > 0) return route.fulfill({ status: 502, body: 'bad gateway' });
            return route.fulfill({ path: 'image/icon-512.png', contentType: 'image/png' });
        }
        return route.fulfill({ status: 404, body: 'not mocked' });
    });
    await page.goto('/');
    const cover = page.locator('#douban-results .douban-cover');
    await expect(cover).toHaveClass(/is-loaded/, { timeout: 5000 });
    expect(await cover.getAttribute('data-retry')).toBe('1');
});
