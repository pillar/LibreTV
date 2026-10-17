// 打开播放页（js/play-context.js）：详情、观看历史直接进入播放页；剧集列表按标签页保存，没有时按 source + id 重新获取
import { test, expect } from '@playwright/test';
import { prepare, login, mockSources, vod } from './helpers.js';

const episodesOf = (id, count) => ({
    vod_play_url: Array.from({ length: count }, (_, i) => `第${i + 1}集$https://media.example/${id}/${i + 1}.m3u8`).join('#')
});

test.beforeEach(async ({ page }) => {
    await prepare(page);
    await login(page);
});

test('从详情点选集直接进入播放页，返回回到搜索结果', async ({ page }) => {
    await mockSources(page, { search: host => (host.includes('bfzy') ? [vod('b1', '示例剧')] : []) });
    const pages = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) pages.push(new URL(frame.url()).pathname); });
    await page.goto('/');
    await page.fill('#searchInput', '示例');
    await page.click('button.search-go');
    await page.locator('#results .card-hover').first().click();
    const searchUrl = page.url();
    await page.locator('#episodesGrid [data-action="playVideo"]').nth(1).click();

    await page.waitForURL(/\/player(\.html)?\?/);
    const params = new URL(page.url()).searchParams;
    expect(Object.fromEntries(['source', 'id', 'index', 'url', 'title'].map(k => [k, params.get(k)])))
        .toEqual({ source: 'bfzy', id: 'b1', index: '1', url: 'https://media.example/b1/2.m3u8', title: '示例剧' });
    expect(pages.some(path => path.includes('watch'))).toBe(false);
    await expect(page.locator('#episodesList button')).toHaveCount(3);
    await expect(page.locator('#episodeInfo')).toHaveText('第 2/3 集');

    await page.click('[data-action="goBack"] >> nth=0');
    await page.waitForURL(searchUrl);
});

test('两个标签页播放不同的剧，各自的剧集列表互不影响', async ({ page, context }) => {
    await mockSources(page, { search: host => (host.includes('bfzy') ? [vod('b1', '甲剧'), vod('b2', '乙剧')] : []) });
    await page.goto('/');
    await page.fill('#searchInput', '剧');
    await page.click('button.search-go');
    await page.locator('#results .card-hover', { hasText: '甲剧' }).click();
    await page.locator('#episodesGrid [data-action="playVideo"]').first().click();
    await page.waitForURL(/\/player/);

    // 第二个标签页播放乙剧（新标签页的 sessionStorage 是独立的）
    const other = await context.newPage();
    await prepare(other);
    await mockSources(other, { search: host => (host.includes('bfzy') ? [vod('b1', '甲剧'), vod('b2', '乙剧')] : []) });
    await other.goto('/');
    await other.fill('#searchInput', '剧');
    await other.click('button.search-go');
    await other.locator('#results .card-hover', { hasText: '乙剧' }).click();
    await other.locator('#episodesGrid [data-action="playVideo"]').first().click();
    await other.waitForURL(/\/player/);

    // 回到第一个标签页刷新后点下一集，仍是甲剧
    await page.reload();
    await page.click('#nextButton');
    await expect(page).toHaveURL(/index=1/);
    expect(new URL(page.url()).searchParams.get('url')).toBe('https://media.example/b1/2.m3u8');
});

test('从观看历史继续播放：先用保存的列表，再同步到最新的剧集列表，并从上次的位置开始', async ({ page }) => {
    await mockSources(page, { detail: id => vod(id, '历史剧', episodesOf(id, 4)) });
    await page.addInitScript(() => {
        localStorage.setItem('viewingHistory', JSON.stringify([{
            title: '历史剧', url: 'player.html?source=bfzy&id=h1&index=1', directVideoUrl: 'https://media.example/h1/2.m3u8',
            episodeIndex: 1, episodes: ['https://media.example/h1/1.m3u8', 'https://media.example/h1/2.m3u8'],
            playbackPosition: 600, duration: 2400, sourceCode: 'bfzy', sourceName: '暴风资源', vod_id: 'h1', timestamp: Date.now()
        }]));
    });
    await page.goto('/');
    await page.locator('#continueWatching .cw-card').click();
    await page.waitForURL(/\/player/);
    const params = new URL(page.url()).searchParams;
    expect([params.get('url'), params.get('position'), params.get('index')]).toEqual(['https://media.example/h1/2.m3u8', '600', '1']);
    await expect(page.locator('#episodesList button')).toHaveCount(4);
});

test('网址只有数据源和视频 ID 时（例如在新标签页打开），获取详情后播放对应的集', async ({ page }) => {
    await mockSources(page, { detail: id => vod(id, '新剧', episodesOf(id, 3)) });
    await page.goto('/player.html?source=bfzy&id=n1&index=2&title=' + encodeURIComponent('新剧'));
    await expect(page.locator('#episodesList button')).toHaveCount(3);
    await expect(page.locator('#episodeInfo')).toHaveText('第 3/3 集');
    await expect.poll(() => page.evaluate(() => currentVideoUrl)).toBe('https://media.example/n1/3.m3u8');
});
