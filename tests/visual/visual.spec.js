// 外观对比的界面状态（运行方式见 playwright.config.js）。数据全部模拟，播放器画面区域遮住不比较。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepare, login, mockSources, vod } from '../helpers.js';

const POSTER = readFileSync(new URL('../../image/icon-512.png', import.meta.url));
const DOUBAN = Array.from({ length: 16 }, (_, i) => ({
    id: String(i), title: '豆瓣电影' + i, rate: '8.' + (i % 10), cover: 'http://localhost:8099/image/icon-512.png', url: 'https://movie.douban.com/subject/' + i
}));
const HISTORY = [
    { title: '历史剧一', url: 'player.html?source=bfzy&id=h1', directVideoUrl: 'https://media.example/h1/2.m3u8', episodeIndex: 1, episodes: ['a', 'b', 'c'], playbackPosition: 600, duration: 2400, poster: '', sourceName: '暴风资源', sourceCode: 'bfzy', vod_id: 'h1', timestamp: 1760000000000 },
    { title: 'Movie Two', url: 'player.html?source=ruyi&id=h2', directVideoUrl: 'https://media.example/h2/1.m3u8', episodeIndex: 0, episodes: ['a'], playbackPosition: 100, duration: 5400, poster: '', sourceName: '如意资源', sourceCode: 'ruyi', vod_id: 'h2', timestamp: 1760000000000 }
];

async function shot(page, name, options = {}) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    // soft：一个界面不一致时继续截后面的界面（第一次运行时也能一次写出全部基准截图）
    await expect.soft(page).toHaveScreenshot(`${name}-${test.info().project.name}.png`, { fullPage: false, ...options });
}

/** 海报图片（tests/helpers.js 的模拟数据指向 localhost:8099）、视频地址一律本地应答 */
async function common(page) {
    await page.route('http://localhost:8099/**', route => route.fulfill({ contentType: 'image/png', body: POSTER }));
    await page.route('https://media.example/**', route => route.fulfill({ status: 404, body: '' }));
}

async function home(page, { history = false } = {}) {
    await common(page);
    await prepare(page, { douban: true });
    if (history) await page.addInitScript(items => localStorage.setItem('viewingHistory', JSON.stringify(items)), HISTORY);
    await login(page);
    await mockSources(page, {
        search: host => host.includes('bfzy')
            ? [vod('b1', '示例剧'), vod('b2', '另一个很长很长的剧集名称用于测试截断效果')]
            : [vod('r1', '示例 剧'), vod('r3', 'English Title')],
        douban: DOUBAN
    });
    await page.goto('/');
    await expect(page.locator('#douban-results .douban-card').first()).toBeVisible();
}

async function player(page, episodes = 12) {
    await common(page);
    await prepare(page);
    await login(page);
    await mockSources(page, { search: host => host.includes('bfzy') ? [vod('p1', '播放测试')] : [vod('r1', '播放测试')] });
    await page.addInitScript(count => sessionStorage.setItem('playContext:bfzy:p1', JSON.stringify({
        title: '播放测试', episodes: Array.from({ length: count }, (_, i) => `https://media.example/p1/${i + 1}.m3u8`)
    })), episodes);
    await page.goto('/player.html?source=bfzy&id=p1&index=0&title=' + encodeURIComponent('播放测试') + '&url=' + encodeURIComponent('https://media.example/p1/1.m3u8'));
    await expect(page.locator('#episodesList button')).toHaveCount(episodes);
    await page.waitForTimeout(1500);
}

test('首页', async ({ page }) => {
    await home(page, { history: true });
    await shot(page, 'home', { fullPage: true });
});

test('搜索结果与详情', async ({ page }) => {
    await home(page);
    await page.fill('#searchInput', '示例');
    await page.click('button.search-go');
    await expect(page.locator('#results .card-hover')).toHaveCount(3);
    await shot(page, 'results', { fullPage: true });
    await page.locator('#results .card-hover').first().click();
    await expect(page.locator('#episodesGrid button').first()).toBeVisible();
    await shot(page, 'detail');
});

test('设置与历史面板', async ({ page }) => {
    await home(page, { history: true });
    await page.evaluate(() => document.getElementById('settingsPanel').classList.add('show'));
    await shot(page, 'settings');
    await page.evaluate(() => showAddCustomApiForm());
    await shot(page, 'custom-api');
    await page.evaluate(() => {
        customAPIs = [{ name: '自定义源', url: 'https://custom.example/api.php/provide/vod', isAdult: false }];
        renderCustomAPIsList();
        editCustomApi(0);
    });
    await shot(page, 'custom-api-edit');
    await page.evaluate(() => {
        document.getElementById('settingsPanel').classList.remove('show');
        toggleHistory();
    });
    await expect(page.locator('#historyPanel')).toHaveClass(/show/);
    await shot(page, 'history');
});

test('弹窗与提示', async ({ page }) => {
    await home(page);
    await page.evaluate(() => showTagManageModal());
    await shot(page, 'tags');
    await page.reload();
    await page.evaluate(() => clearLocalStorage());
    await shot(page, 'confirm');
    await page.reload();
    await page.evaluate(() => showImportBox(() => {}));
    await shot(page, 'import');
    await page.reload();
    await page.evaluate(() => {
        showLoading('加载中...');
        showToast('提示信息', 'success');
    });
    await page.waitForTimeout(500);
    await shot(page, 'loading');
    await page.reload();
    await page.evaluate(() => showAdminPasswordModal());
    await shot(page, 'admin-password');
    await page.reload();
    await page.evaluate(() => { importConfigFromUrl(); });
    await expect(page.locator('#confirmUrlImport')).toBeVisible();
    await shot(page, 'url-import');
});

test('短剧', async ({ page }) => {
    await common(page);
    await prepare(page, { douban: true });
    await login(page);
    await page.route('**/proxy/**', route => {
        const url = new URL(decodeURIComponent(route.request().url().split('/proxy/')[1]));
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.hostname === 'movie.douban.com') return json({ subjects: [], tags: ['热门', '最新'] });
        if (url.searchParams.get('ac') === 'list') return json({ class: [{ type_id: 46, type_pid: 0, type_name: '短剧' }, { type_id: 47, type_pid: 46, type_name: '重生民国' }], list: [] });
        if (url.searchParams.get('ac') === 'videolist') return json({ list: [vod('s1', '短剧一'), vod('s2', '短剧二')], pagecount: 1 });
        return route.fulfill({ status: 502, body: '' });
    });
    await page.goto('/');
    await page.click('#douban-short-toggle');
    await expect(page.locator('.short-drama-card').first()).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, 'short');
});

test('登录与声明', async ({ page }) => {
    await page.goto('/');
    await shot(page, 'login');
});

test('播放页', async ({ page }) => {
    await player(page);
    await shot(page, 'player', { fullPage: true, mask: [page.locator('#player')] });
    await page.evaluate(() => showPasswordModal());
    await shot(page, 'player-password', { mask: [page.locator('#player')] });
    await page.evaluate(() => hidePasswordModal());
    await page.evaluate(() => showSwitchResourceModal());
    await expect(page.locator('#modalContent').getByText('当前播放')).toBeVisible();
    // 遮挡块会画在弹窗上面，这里改为隐藏播放器（其中的加载动画会让截图不稳定）
    await page.addStyleTag({ content: '#player { visibility: hidden; }' });
    await shot(page, 'switch-source');
});

test('播放页锁定', async ({ page }) => {
    await player(page, 2);
    await page.evaluate(() => setControlsLocked(true));
    await page.waitForTimeout(300);
    await shot(page, 'locked', { fullPage: true, mask: [page.locator('.art-video')] });
});

test('关于与隐私', async ({ page }) => {
    await page.goto('/about.html');
    await shot(page, 'about', { fullPage: true });
    await page.goto('/privacy.html');
    await shot(page, 'privacy', { fullPage: true });
});
