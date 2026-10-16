// 内容安全策略（lib/handler.mjs）：页面不能依赖内联脚本或内联事件，主要操作过程中不应出现任何 CSP 拦截或脚本错误
import { test, expect } from '@playwright/test';
import { prepare, login, mockSources, vod } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await prepare(page, { douban: true });
    await login(page);
    await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
});

async function expectClean(page, errors) {
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
}

test('页面带有 CSP，首页的搜索、详情、历史、豆瓣推荐都能正常操作', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockSources(page, {
        search: () => [vod('a1', '示例剧')],
        douban: [{ title: '豆瓣片', rate: '8.0', url: 'https://movie.douban.com/subject/1/', cover: 'https://img1.doubanio.com/p.jpg' }]
    });
    const response = await page.goto('/');
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");

    await expect(page.locator('#douban-results .douban-card')).toHaveCount(1);
    await page.fill('#searchInput', '示例');
    await expect(page.locator('#clearSearchInput')).toBeVisible();
    await page.click('button.search-go');
    await page.locator('#results .card-hover').first().click();
    await expect(page.locator('#episodesGrid button')).toHaveCount(3);
    await page.click('#episodeOrderToggle');
    await expect(page.locator('#episodesGrid button').first()).toHaveText('3');
    await page.click('#modal [data-action="closeModal"]');

    await page.click('.tv-nav [data-action="toggleHistory"]');
    await expect(page.locator('#historyPanel')).toHaveClass(/show/);
    // 播放过的视频出现在历史中，删除后面板保持打开
    await page.evaluate(() => addToViewingHistory({ title: '历史剧', url: 'player.html?url=x', episodeIndex: 0, sourceName: 'bfzy', vod_id: 'a1', episodes: ['x'] }));
    await page.click('.tv-nav [data-action="toggleHistory"]');
    await page.click('.tv-nav [data-action="toggleHistory"]');
    await expect(page.locator('#historyPanel')).toHaveClass(/show/);
    const historyItem = page.locator('#historyList .history-item').first();
    await historyItem.hover();
    await historyItem.locator('[data-action="deleteHistoryItem"]').click();
    await expect(page.locator('#historyList [data-action="playFromHistory"]')).toHaveCount(0);
    await expect(page.locator('#historyPanel')).toHaveClass(/show/);

    // 管理员登录后，点击设置按钮打开设置面板且保持打开
    await page.request.post('/auth/login', { data: { password: 'admin-pass', type: 'admin' } });
    await page.reload();
    await page.click('.tv-nav [data-action="toggleSettings"]');
    await expect(page.locator('#settingsPanel')).toHaveClass(/show/);
    await page.click('#settingsPanel [data-action="selectAllAPIs"] >> nth=1');
    await expect(page.locator('#settingsPanel')).toHaveClass(/show/);
    await expectClean(page, errors);
});

test('播放页带有 CSP，选集、锁定、返回等操作正常', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('currentEpisodes', JSON.stringify(['https://media.example/1.m3u8', 'https://media.example/2.m3u8'])));
    await page.goto('/player.html?url=' + encodeURIComponent('https://media.example/1.m3u8') + '&title=Demo&index=0');
    await expect(page.locator('#episodesList button')).toHaveCount(2);
    await page.click('#lockToggle');
    await expect(page.locator('.art-video-player')).toHaveClass(/art-locked/);
    await page.click('#lockToggle');
    await page.click('#episodesList button >> nth=1');
    await expect(page).toHaveURL(/index=1/);
    await expectClean(page, errors);
});
