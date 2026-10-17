// 首页「短剧」频道：从资源站的短剧分类取内容（js/short-drama.js），同名剧合并，按题材标签切换，排除擦边分类
import { test, expect } from '@playwright/test';
import { prepare, login, vod } from './helpers.js';

const CLASSES = {
    'cj.rycjapi.com': [{ type_id: 1, type_pid: 0, type_name: '电影' }, { type_id: 46, type_pid: 2, type_name: '短剧' }],
    'bfzyapi.com': [
        { type_id: 58, type_pid: 0, type_name: '短剧大全' },
        { type_id: 65, type_pid: 58, type_name: '重生民国' },
        { type_id: 74, type_pid: 58, type_name: 'AI漫剧' },
        { type_id: 73, type_pid: 58, type_name: '擦边短剧' }
    ]
};
const LISTS = {
    'cj.rycjapi.com:46': [vod('r1', '总裁归来'), vod('r2', '重生之路')],
    'bfzyapi.com:58': [vod('b1', '总裁归来')],
    'bfzyapi.com:65': [vod('b5', '民国往事')],
    'bfzyapi.com:74': [vod('b7', 'AI剧')]
};

test('切换到短剧后显示各站短剧分类的内容，可按题材切换，点击打开详情并可切换数据源', async ({ page }) => {
    await prepare(page, { douban: true });
    await login(page);
    const requestedTypes = [];
    await page.route('**/proxy/**', route => {
        const url = new URL(decodeURIComponent(route.request().url().split('/proxy/')[1]));
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.hostname === 'movie.douban.com') return json({ subjects: [] });
        const ac = url.searchParams.get('ac');
        if (ac === 'list' && CLASSES[url.hostname]) return json({ class: CLASSES[url.hostname], list: [] });
        if (ac === 'videolist' && url.searchParams.has('ids')) return json({ list: [vod(url.searchParams.get('ids'), '总裁归来')] });
        if (ac === 'videolist' && url.searchParams.has('t')) {
            requestedTypes.push(`${url.hostname}:${url.searchParams.get('t')}`);
            return json({ list: LISTS[`${url.hostname}:${url.searchParams.get('t')}`] || [], pagecount: 1 });
        }
        // 其余短剧源（电影天堂、极速、360）不可用
        return route.fulfill({ status: 502, body: 'down' });
    });
    await page.goto('/');
    await page.click('#douban-short-toggle');
    await expect(page.locator('#douban-title')).toHaveText('热门短剧');

    const cards = page.locator('#douban-results .short-drama-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: '总裁归来' })).toContainText('2 个源');
    await expect(page.locator('#douban-tags button')).toHaveText(['最新', '古装仙侠', '现代都市', '穿越年代', '重生民国', '言情总裁', '反转爽剧', '脑洞悬疑', 'AI短剧']);

    await page.locator('#douban-tags button', { hasText: '重生民国' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('民国往事');
    await page.locator('#douban-tags button', { hasText: 'AI短剧' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('AI剧');
    // 擦边分类不会被请求
    expect(requestedTypes).not.toContain('bfzyapi.com:73');

    await page.locator('#douban-tags button', { hasText: '最新' }).click();
    await cards.filter({ hasText: '总裁归来' }).click();
    await expect(page.locator('#modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modal .source-switcher button')).toHaveCount(2);
    await expect(page.locator('#episodesGrid [data-action="playVideo"]')).toHaveCount(3);
});
