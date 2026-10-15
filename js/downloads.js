// 离线缓存（仅 iOS / Android App）：把 HLS 视频的播放列表、分片和密钥下载到本地，断网也能播放。
// 前台下载：App 切到后台时暂停，回到前台后自动继续；已下载的分片不会重复下载。
// 文件存放在 App 的 Library/downloads/<id>/ 下：index.m3u8（改写为本地地址）+ 分片 + 密钥 + manifest.json。
(function () {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    const { Filesystem, FileTransfer, CapacitorHttp } = cap.Plugins || {};
    if (!Filesystem || !FileTransfer || !CapacitorHttp) {
        console.error('离线缓存不可用：缺少 Filesystem / FileTransfer 插件');
        return;
    }

    const DIRECTORY = 'LIBRARY';
    const ROOT = 'downloads';
    const STORE_KEY = 'offlineDownloads';
    const CONCURRENCY = 4;
    const RETRIES = 2;

    // ---- 持久化：下载条目与剧集列表 ----
    // items: { [id]: { id, seriesKey, title, episodeIndex, url, status, total, done, error, createdAt } }
    // series: { [seriesKey]: { title, vodId, sourceCode, episodes: [原始地址...] } }
    function loadStore() {
        try {
            const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            return { items: data.items || {}, series: data.series || {} };
        } catch {
            return { items: {}, series: {} };
        }
    }
    let store = loadStore();
    let saveTimer = null;
    function save(immediate) {
        clearTimeout(saveTimer);
        const write = () => localStorage.setItem(STORE_KEY, JSON.stringify(store));
        if (immediate) write();
        else saveTimer = setTimeout(write, 500);
    }

    const listeners = new Set();
    function emit() {
        listeners.forEach(fn => {
            try { fn(); } catch (error) { console.error(error); }
        });
    }

    function hashId(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
        return h.toString(36) + text.length.toString(36);
    }

    const folderOf = id => `${ROOT}/${id}`;

    async function fileUri(path) {
        return (await Filesystem.getUri({ directory: DIRECTORY, path })).uri;
    }

    async function fetchText(url) {
        const res = await CapacitorHttp.request({ url, method: 'GET', responseType: 'text', connectTimeout: 15000, readTimeout: 20000 });
        if (res.status < 200 || res.status >= 300) throw new Error(`请求播放列表失败（HTTP ${res.status}）`);
        return typeof res.data === 'string' ? res.data : String(res.data);
    }

    // ---- 播放列表解析 ----
    // 多码率总列表取带宽最高的一路；媒体列表中的分片、密钥（EXT-X-KEY）、初始化段（EXT-X-MAP）都改写为本地文件名。
    async function resolveMediaPlaylist(url) {
        let text = await fetchText(url);
        if (!text.includes('#EXTM3U')) throw new Error('不是有效的 HLS 播放列表');
        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split(/\r?\n/);
            let best = null;
            lines.forEach((line, i) => {
                if (!line.startsWith('#EXT-X-STREAM-INF')) return;
                const bandwidth = Number((line.match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
                const next = lines.slice(i + 1).find(l => l.trim() && !l.startsWith('#'));
                if (next && (!best || bandwidth > best.bandwidth)) best = { bandwidth, uri: next.trim() };
            });
            if (!best) throw new Error('播放列表中没有可用的视频流');
            url = new URL(best.uri, url).href;
            text = await fetchText(url);
        }
        return { url, text };
    }

    function buildLocalPlaylist(text, baseUrl) {
        const files = [];
        let segmentCount = 0;
        let extraCount = 0;
        const localName = (remote, prefix) => {
            const ext = (new URL(remote).pathname.match(/\.[a-z0-9]{1,5}$/i) || [''])[0] || (prefix === 'seg' ? '.ts' : '.bin');
            const index = prefix === 'seg' ? ++segmentCount : ++extraCount;
            const name = `${prefix}${String(index).padStart(5, '0')}${ext}`;
            files.push({ url: remote, name });
            return name;
        };
        const lines = text.split(/\r?\n/).map(raw => {
            const line = raw.trim();
            if (!line) return line;
            if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
                return line.replace(/URI="([^"]+)"/, (_, uri) => `URI="${localName(new URL(uri, baseUrl).href, line.startsWith('#EXT-X-KEY') ? 'key' : 'init')}"`);
            }
            if (line.startsWith('#')) return line;
            return localName(new URL(line, baseUrl).href, 'seg');
        });
        return { playlist: lines.join('\n'), files, segmentCount };
    }

    // ---- 下载执行 ----
    let running = null;          // 正在下载的条目 id
    let pauseRequested = false;  // 当前下载是否被要求暂停

    async function listDoneFiles(folder) {
        try {
            const { files } = await Filesystem.readdir({ directory: DIRECTORY, path: folder });
            return new Set(files.map(f => f.name).filter(name => !name.endsWith('.part')));
        } catch {
            return new Set();
        }
    }

    async function downloadOne(folder, file) {
        const finalPath = `${folder}/${file.name}`;
        const partPath = `${finalPath}.part`;
        let lastError = null;
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            try {
                // 先下载到 .part，完成后再改名，中断时不会留下不完整的文件
                await FileTransfer.downloadFile({ url: file.url, path: await fileUri(partPath), connectTimeout: 20000, readTimeout: 30000 });
                await Filesystem.rename({ directory: DIRECTORY, from: partPath, to: finalPath, toDirectory: DIRECTORY });
                return;
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(`下载分片失败：${(lastError && lastError.message) || '网络错误'}`);
    }

    async function runItem(item) {
        const folder = folderOf(item.id);
        await Filesystem.mkdir({ directory: DIRECTORY, path: folder, recursive: true }).catch(() => {});

        // 第一次下载时解析播放列表并写入本地 index.m3u8 与文件清单
        let manifest = null;
        try {
            manifest = JSON.parse((await Filesystem.readFile({ directory: DIRECTORY, path: `${folder}/manifest.json`, encoding: 'utf8' })).data);
        } catch {
            const { url, text } = await resolveMediaPlaylist(item.url);
            const { playlist, files } = buildLocalPlaylist(text, url);
            if (!files.length) throw new Error('播放列表中没有视频分片');
            await Filesystem.writeFile({ directory: DIRECTORY, path: `${folder}/index.m3u8`, data: playlist, encoding: 'utf8' });
            manifest = { files };
            await Filesystem.writeFile({ directory: DIRECTORY, path: `${folder}/manifest.json`, data: JSON.stringify(manifest), encoding: 'utf8' });
        }

        const doneNames = await listDoneFiles(folder);
        const pending = manifest.files.filter(f => !doneNames.has(f.name));
        item.total = manifest.files.length;
        item.done = item.total - pending.length;
        save(); emit();

        let cursor = 0;
        let failure = null;
        const worker = async () => {
            while (!pauseRequested && !failure && cursor < pending.length) {
                const file = pending[cursor++];
                try {
                    await downloadOne(folder, file);
                    item.done++;
                    save(); emit();
                } catch (error) {
                    failure = error;
                }
            }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        if (failure) throw failure;
        return !pauseRequested && item.done >= item.total;
    }

    async function pump() {
        if (running) return;
        const next = Object.values(store.items)
            .filter(item => item.status === 'queued')
            .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) return;

        running = next.id;
        pauseRequested = false;
        next.status = 'downloading';
        next.error = '';
        save(true); emit();
        try {
            const finished = await runItem(next);
            if (store.items[next.id]) next.status = finished ? 'done' : 'paused';
        } catch (error) {
            if (store.items[next.id]) {
                next.status = 'error';
                next.error = error.message || '下载失败';
            }
        }
        running = null;
        save(true); emit();
        pump();
    }

    // 前台下载：切到后台时暂停正在下载的条目，回到前台后继续
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (running) {
                store.items[running].autoResume = true;
                pauseRequested = true;
            }
        } else {
            Object.values(store.items).forEach(item => {
                if (item.autoResume && item.status !== 'done') item.status = 'queued';
                delete item.autoResume;
            });
            save(true);
            pump();
        }
    });

    // ---- 对外接口 ----
    const api = {
        // episodes: [{ url, episodeIndex }]，series: { title, vodId, sourceCode, episodes }
        add(series, episodes) {
            const seriesKey = `${series.sourceCode || ''}:${series.vodId || series.title}`;
            store.series[seriesKey] = { title: series.title, vodId: series.vodId, sourceCode: series.sourceCode, episodes: series.episodes };
            let added = 0;
            episodes.forEach(({ url, episodeIndex }) => {
                const id = hashId(url);
                const existing = store.items[id];
                if (existing && existing.status !== 'error') return;
                store.items[id] = {
                    id, seriesKey, title: series.title, episodeIndex, url,
                    status: 'queued', total: 0, done: 0, error: '', createdAt: Date.now() + added
                };
                added++;
            });
            save(true); emit(); pump();
            return added;
        },
        list() {
            return Object.values(store.items).sort((a, b) =>
                a.seriesKey === b.seriesKey ? a.episodeIndex - b.episodeIndex : a.createdAt - b.createdAt);
        },
        series(key) {
            return store.series[key];
        },
        pause(id) {
            const item = store.items[id];
            if (!item) return;
            if (running === id) pauseRequested = true;
            else if (item.status === 'queued') item.status = 'paused';
            save(true); emit();
        },
        resume(id) {
            const item = store.items[id];
            if (!item || item.status === 'done' || running === id) return;
            item.status = 'queued';
            save(true); emit(); pump();
        },
        async remove(id) {
            if (running === id) pauseRequested = true;
            delete store.items[id];
            // 剧集没有其他下载条目时一并清理剧集记录
            Object.keys(store.series).forEach(key => {
                if (!Object.values(store.items).some(item => item.seriesKey === key)) delete store.series[key];
            });
            save(true); emit();
            await Filesystem.rmdir({ directory: DIRECTORY, path: folderOf(id), recursive: true }).catch(() => {});
        },
        // 已下载条目的本地播放地址（WebView 可访问的 capacitor:// / https://localhost 地址）
        async localUrl(id) {
            return cap.convertFileSrc(await fileUri(`${folderOf(id)}/index.m3u8`));
        },
        statusOf(url) {
            const item = store.items[hashId(url)];
            return item ? item.status : null;
        },
        async usage() {
            let bytes = 0;
            for (const id of Object.keys(store.items)) {
                try {
                    const { files } = await Filesystem.readdir({ directory: DIRECTORY, path: folderOf(id) });
                    files.forEach(f => { bytes += f.size || 0; });
                } catch { /* 目录可能尚未创建 */ }
            }
            return bytes;
        },
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        // 打开离线播放：已下载的集用本地地址，其余保持原地址（联网时仍可在线播放），集数编号保持不变
        async play(id) {
            const item = store.items[id];
            if (!item) return;
            const series = store.series[item.seriesKey] || { episodes: [item.url] };
            const episodes = await Promise.all(series.episodes.map(async url => {
                const downloaded = store.items[hashId(url)];
                return downloaded && downloaded.status === 'done' ? api.localUrl(downloaded.id) : url;
            }));
            const index = Math.max(0, series.episodes.indexOf(item.url));
            localStorage.setItem('currentEpisodes', JSON.stringify(episodes));
            localStorage.setItem('currentVideoTitle', item.title);
            const params = new URLSearchParams({ url: episodes[index], title: item.title, index: String(index), offline: '1' });
            if (series.vodId) params.set('id', series.vodId);
            if (series.sourceCode) params.set('source', series.sourceCode);
            window.location.href = `player.html?${params.toString()}`;
        }
    };

    window.OfflineDownloads = api;

    // 上次退出时正在下载或排队的条目，启动后继续
    Object.values(store.items).forEach(item => {
        if (item.status === 'downloading') item.status = 'queued';
    });
    save(true);
    pump();
})();
