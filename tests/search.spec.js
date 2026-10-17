// 搜索结果合并、数据源切换、详情展示与 XSS 防护
import { test, expect } from '@playwright/test';
import { prepare, login, mockSources, vod } from './helpers.js';

test.beforeEach(async ({ page }) => {
    await prepare(page);
    await login(page);
});

test('同名剧集合并为一张卡片，详情中可切换数据源', async ({ page }) => {
    await mockSources(page, {
        search: host => host.includes('bfzy')
            ? [vod('b1', '示例剧'), vod('b2', '只在暴风')]
            : [vod('r1', '示例 剧'), vod('r2', '另一部')],
        detail: id => (id === 'r1' ? vod('r1', '示例剧', { vod_play_url: '' }) : vod(id, '示例剧'))
    });
    await page.goto('/');
    await page.fill('#searchInput', '示例');
    await page.click('button.search-go');

    const cards = page.locator('#results .card-hover');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('#searchResultsCount')).toHaveText('3');
    await expect(cards.first()).toContainText('2 个源');

    await cards.first().click();
    const switcher = page.locator('.source-switcher button');
    await expect(switcher).toHaveCount(2);
    await expect(switcher.first()).toHaveClass(/is-active/);
    await expect(page.locator('#episodesGrid button')).toHaveCount(3);
    // 简介中的 HTML 实体按文字显示
    await expect(page.locator('.detail-desc-content')).toHaveText('简介 内容');

    // 切到没有剧集的源：仍然显示切换栏，可以切回去
    await switcher.nth(1).click();
    await expect(page.locator('#modalTitle')).toContainText('如意资源');
    await expect(page.locator('.source-switcher button').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('#episodesGrid button')).toHaveCount(0);
});

test('数据源返回的恶意内容不会被执行', async ({ page }) => {
    const evil = `x');window.__pwn=1;//"><img src=x onerror="window.__pwn=2">`;
    await mockSources(page, {
        search: () => [vod('e1', evil, { vod_pic: 'http://x" onerror="window.__pwn=3', vod_year: evil, type_name: evil })],
        detail: () => vod('e1', evil, { vod_content: '<img src=x onerror="window.__pwn=4">', vod_actor: evil, vod_play_url: `第1集$https://a.example/a.m3u8');window.__pwn=5;//` })
    });
    await page.goto('/');
    await page.fill('#searchInput', 'x');
    await page.click('button.search-go');
    await expect(page.locator('#results h3')).toHaveText(evil);
    await page.locator('#results .card-hover').first().click();
    await expect(page.locator('#modalTitle span').first()).toHaveText(evil);
    expect(await page.evaluate(() => window.__pwn || 0)).toBe(0);
});

test('播放页 URL 参数中的恶意内容不会被执行，javascript: 返回地址被拒绝', async ({ page }) => {
    const params = new URLSearchParams({
        url: 'https://media.example/none.m3u8',
        title: '<img src=x onerror="window.__pwn=6">',
        source: '<img src=x onerror="window.__pwn=7">',
        returnUrl: 'javascript:window.__pwn=8'
    });
    await page.goto('/player.html?' + params);
    await expect(page.locator('#resourceInfoBarContainer .resource-info-bar-left span').first()).toHaveText('<img src=x onerror="window.__pwn=7">');
    await page.evaluate(() => goBack());
    await page.waitForURL(url => url.pathname === '/' || url.pathname === '/index.html');
    expect(await page.evaluate(() => window.__pwn || 0)).toBe(0);
});

test('先返回的数据源先显示，慢的数据源返回后追加并更新进度', async ({ page }) => {
    let releaseSlow;
    const slowGate = new Promise(resolve => { releaseSlow = resolve; });
    await page.route('**/proxy/**', async route => {
        const url = new URL(decodeURIComponent(route.request().url().split('/proxy/')[1]));
        const fast = url.hostname.includes('bfzy');
        if (!fast) await slowGate;
        const list = fast ? [vod('b1', '快的剧')] : [vod('r1', '慢的剧')];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ list, pagecount: 1 }) });
    });
    await page.goto('/');
    await page.fill('#searchInput', '剧');
    await page.click('button.search-go');

    const cards = page.locator('#results .card-hover');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('快的剧');
    await expect(page.locator('#searchProgress')).toHaveText('正在搜索 1/2 个源 · ');

    releaseSlow();
    await expect(cards).toHaveCount(2);
    await expect(page.locator('#searchResultsCount')).toHaveText('2');
    await expect(page.locator('#searchProgress')).toHaveText('');
});

test('详情优先使用 m3u8 播放源（第一个播放源只是网页链接时）', async ({ page }) => {
    await mockSources(page, {
        search: () => [vod('m1', '多源剧')],
        detail: id => vod(id, '多源剧', {
            vod_play_url: '第1集$https://share.example/a#第2集$https://share.example/b$$$第1集$https://media.example/1.m3u8#第2集$https://media.example/2.m3u8'
        })
    });
    await page.goto('/');
    await page.fill('#searchInput', '多源');
    await page.click('button.search-go');
    await page.locator('#results .card-hover').first().click();
    const episodes = page.locator('#episodesGrid [data-action="playVideo"]');
    await expect(episodes).toHaveCount(2);
    expect(await episodes.first().getAttribute('data-args')).toContain('https://media.example/1.m3u8');
});

test('数据源连续 3 次搜索失败后暂时跳过，设置中标出；搜到 0 条不算失败', async ({ page }) => {
    const requests = { bfzy: 0, ruyi: 0 };
    await page.route('**/proxy/**', route => {
        const url = new URL(decodeURIComponent(route.request().url().split('/proxy/')[1]));
        if (url.hostname.includes('bfzy')) {
            requests.bfzy++;
            // 失效的源：域名被转到其他网页
            return route.fulfill({ contentType: 'text/html', body: '<html>parked</html>' });
        }
        requests.ruyi++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ list: [], pagecount: 1 }) });
    });
    await page.goto('/');
    for (const [i, keyword] of ['甲', '乙', '丙', '丁'].entries()) {
        await page.fill('#searchInput', keyword);
        await page.click('button.search-go');
        await expect.poll(() => requests.ruyi).toBe(i + 1);
        await expect(page.locator('#searchProgress')).not.toContainText('正在搜索');
    }
    expect(requests).toEqual({ bfzy: 3, ruyi: 4 });
    await expect(page.locator('#searchProgress')).toHaveText('已跳过 1 个暂不可用的源 · ');

    await page.reload();
    await page.locator('[aria-label="打开设置"]').click();
    await expect(page.locator('label[for="api_bfzy"]')).toHaveClass(/source-unavailable/);
    await expect(page.locator('label[for="api_bfzy"]')).toHaveAttribute('title', '最近连续搜索失败，暂时跳过');
    await expect(page.locator('label[for="api_ruyi"]')).not.toHaveClass(/source-unavailable/);
});
