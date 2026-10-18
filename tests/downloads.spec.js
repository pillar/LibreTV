// App 离线缓存（js/downloads.js）：用内存中的 Filesystem / FileTransfer / CapacitorHttp 模拟原生插件，分片下载可控制何时完成
import { test, expect } from '@playwright/test';
import { prepare, login } from './helpers.js';

const SEGMENTS = 40;

async function setup(page) {
    await prepare(page);
    await login(page);
    await page.addInitScript(count => {
        const files = new Map();            // 路径 → 内容
        const pathOf = uri => uri.replace('file:///app/', '');
        window.fsFiles = files;
        window.segmentDelay = 50;           // 每个分片下载用时（毫秒）
        window.downloadCalls = 0;
        const playlist = ['#EXTM3U', '#EXT-X-TARGETDURATION:10', '#EXT-X-KEY:METHOD=AES-128,URI="key.key"']
            .concat(Array.from({ length: count }, (_, i) => `#EXTINF:10,\nseg${i}.ts`), '#EXT-X-ENDLIST').join('\n');
        window.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
            convertFileSrc: uri => uri,
            Plugins: {
                CapacitorHttp: { request: async () => ({ status: 200, data: playlist, headers: {} }) },
                FileTransfer: {
                    // 与原生插件一样：目录不存在时自动创建，直接写入目标路径
                    downloadFile: async ({ url, path }) => {
                        window.downloadCalls++;
                        await new Promise(resolve => setTimeout(resolve, window.segmentDelay));
                        files.set(pathOf(path), url);
                    }
                },
                Filesystem: {
                    getUri: async ({ path }) => ({ uri: 'file:///app/' + path }),
                    mkdir: async () => {},
                    writeFile: async ({ path, data }) => { files.set(path, data); },
                    readFile: async ({ path }) => {
                        if (!files.has(path)) throw new Error('File does not exist');
                        return { data: files.get(path) };
                    },
                    readdir: async ({ path }) => {
                        const names = [...files.keys()].filter(p => p.startsWith(path + '/')).map(p => p.slice(path.length + 1));
                        if (!names.length) throw new Error('Directory does not exist');
                        return { files: names.map(name => ({ name, size: 1 })) };
                    },
                    rename: async ({ from, to }) => {
                        if (!files.has(from)) throw new Error('File does not exist');
                        files.set(to, files.get(from));
                        files.delete(from);
                    },
                    rmdir: async ({ path }) => {
                        [...files.keys()].filter(p => p.startsWith(path + '/')).forEach(p => files.delete(p));
                    }
                }
            }
        };
    }, SEGMENTS);
    await page.goto('/');
    await page.waitForFunction(() => window.OfflineDownloads);
}

const add = page => page.evaluate(() => window.OfflineDownloads.add(
    { title: '缓存测试', vodId: 'v1', sourceCode: 'bfzy', episodes: ['https://media.example/v1/1.m3u8'] },
    [{ url: 'https://media.example/v1/1.m3u8', episodeIndex: 0 }]
));
const item = page => page.evaluate(() => window.OfflineDownloads.list()[0]);
const setVisibility = (page, state) => page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
}, state);

test('缓存一集：下载全部分片与密钥，播放列表改写为本地文件', async ({ page }) => {
    await setup(page);
    await add(page);
    await expect.poll(async () => (await item(page)).status).toBe('done');
    const result = await page.evaluate(() => {
        const names = [...window.fsFiles.keys()].filter(p => !p.endsWith('.json') && !p.endsWith('.m3u8'));
        const playlist = [...window.fsFiles.entries()].find(([p]) => p.endsWith('index.m3u8'))[1];
        return { names: names.length, part: names.filter(n => n.endsWith('.part')).length, playlist };
    });
    expect(result.names).toBe(SEGMENTS + 1);
    expect(result.part).toBe(0);
    expect(result.playlist).toContain('URI="key00001.key"');
    expect(result.playlist).toContain('seg00040.ts');
    expect(await item(page)).toMatchObject({ total: SEGMENTS + 1, done: SEGMENTS + 1 });
});

test('下载中删除：等正在下载的分片结束后再删除目录，不留下文件', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { window.segmentDelay = 300; });
    await add(page);
    await expect.poll(() => page.evaluate(() => window.downloadCalls)).toBeGreaterThan(0);
    await page.evaluate(async () => window.OfflineDownloads.remove(window.OfflineDownloads.list()[0].id));
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => [...window.fsFiles.keys()])).toEqual([]);
    expect(await page.evaluate(() => window.OfflineDownloads.list())).toEqual([]);
});

test('切到后台后很快回到前台：正在收尾的下载结束后自动继续', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { window.segmentDelay = 300; });
    await add(page);
    await expect.poll(() => page.evaluate(() => window.downloadCalls)).toBeGreaterThan(0);
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await page.evaluate(() => { window.segmentDelay = 10; });
    await expect.poll(async () => (await item(page)).status, { timeout: 10_000 }).toBe('done');
});

test('暂停后很快继续：正在收尾的下载结束后接着下载', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { window.segmentDelay = 300; });
    await add(page);
    await expect.poll(() => page.evaluate(() => window.downloadCalls)).toBeGreaterThan(0);
    await page.evaluate(() => {
        const id = window.OfflineDownloads.list()[0].id;
        window.OfflineDownloads.pause(id);
        window.OfflineDownloads.resume(id);
        window.segmentDelay = 10;
    });
    await expect.poll(async () => (await item(page)).status, { timeout: 10_000 }).toBe('done');
});
