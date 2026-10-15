// 离线缓存的界面（仅 App）：首页导航栏的「我的下载」面板，播放页的「缓存」按钮。逻辑见 js/downloads.js。
(function () {
    const downloads = window.OfflineDownloads;
    if (!downloads) return;

    const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M5 19h14"/></svg>';
    const STATUS_TEXT = { queued: '等待中', downloading: '下载中', paused: '已暂停', done: '已下载', error: '下载失败' };

    function formatBytes(bytes) {
        if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
        if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
        return `${Math.round(bytes / 1024)} KB`;
    }

    // ---- 首页：我的下载 ----
    function setupDownloadsPanel() {
        const actions = document.querySelector('.tv-nav-actions');
        if (!actions) return;

        const navButton = document.createElement('button');
        navButton.className = 'tv-icon-btn';
        navButton.setAttribute('aria-label', '我的下载');
        navButton.title = '我的下载';
        navButton.innerHTML = ICON_DOWNLOAD.replace('<svg', '<svg class="w-5 h-5"');
        actions.insertBefore(navButton, actions.firstChild);

        const panel = document.createElement('div');
        panel.className = 'downloads-panel';
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <div class="downloads-header">
                <h3>我的下载</h3>
                <button type="button" class="downloads-close" aria-label="关闭">✕</button>
            </div>
            <div class="downloads-list"></div>
            <div class="downloads-footer">
                <span class="downloads-summary"></span>
                <button type="button" class="downloads-clear">全部清空</button>
            </div>`;
        document.body.appendChild(panel);
        const list = panel.querySelector('.downloads-list');
        const footer = panel.querySelector('.downloads-summary');
        const clearButton = panel.querySelector('.downloads-clear');

        const open = () => {
            panel.classList.add('show');
            panel.setAttribute('aria-hidden', 'false');
            render();
            refreshUsage();
        };
        const close = () => {
            panel.classList.remove('show');
            panel.setAttribute('aria-hidden', 'true');
        };
        navButton.addEventListener('click', open);
        clearButton.addEventListener('click', async () => {
            if (!confirm('清空全部下载内容？此操作不可恢复。')) return;
            await downloads.removeAll();
            refreshUsage();
        });
        panel.querySelector('.downloads-close').addEventListener('click', close);
        window.addEventListener('nativeback', event => {
            if (panel.classList.contains('show')) {
                event.preventDefault();
                close();
            }
        });

        // 底部统计：集数每次渲染都更新；占用空间需要读取文件列表，最多每 2 秒统计一次，且最后一次变化后一定补算
        let usageText = '…';
        let usageById = {};
        let usageTimer = null;
        function renderFooter() {
            const items = downloads.list();
            const count = items.filter(item => item.status === 'done').length;
            footer.textContent = `已下载 ${count} 集 · 占用 ${usageText}`;
            clearButton.hidden = !items.length;
        }
        async function refreshUsage() {
            usageById = await downloads.usageById();
            usageText = formatBytes(Object.values(usageById).reduce((sum, bytes) => sum + bytes, 0));
            render();
        }
        function scheduleUsage() {
            if (usageTimer) return;
            usageTimer = setTimeout(() => {
                usageTimer = null;
                if (panel.classList.contains('show')) refreshUsage();
            }, 2000);
        }

        function render() {
            if (!panel.classList.contains('show')) return;
            const items = downloads.list();
            renderFooter();
            if (!items.length) {
                list.innerHTML = '<div class="downloads-empty">还没有下载内容<br>在播放页点「缓存」即可离线观看</div>';
                return;
            }
            const groups = new Map();
            items.forEach(item => {
                if (!groups.has(item.seriesKey)) groups.set(item.seriesKey, []);
                groups.get(item.seriesKey).push(item);
            });
            list.innerHTML = [...groups.values()].map(group => `
                <section class="downloads-group" data-series="${escapeHtml(group[0].seriesKey)}">
                    <div class="downloads-group-header">
                        <div>
                            <h4>${escapeHtml(group[0].title)}</h4>
                            <div class="downloads-group-meta">${group.length} 集 · ${formatBytes(group.reduce((sum, item) => sum + (usageById[item.id] || 0), 0))}</div>
                        </div>
                        <button type="button" data-series-action="remove" class="downloads-remove">删除整部</button>
                    </div>
                    ${group.map(item => {
                        const percent = item.total ? Math.floor(item.done / item.total * 100) : 0;
                        const status = item.status === 'downloading' && item.total
                            ? `下载中 ${percent}%`
                            : STATUS_TEXT[item.status] || item.status;
                        const toggle = item.status === 'done' ? `<button type="button" data-action="play" class="downloads-primary">播放</button>`
                            : item.status === 'downloading' || item.status === 'queued' ? `<button type="button" data-action="pause">暂停</button>`
                                : `<button type="button" data-action="resume">${item.status === 'error' ? '重试' : '继续'}</button>`;
                        return `
                        <div class="downloads-item" data-id="${escapeHtml(item.id)}">
                            <div class="downloads-item-main">
                                <div class="downloads-item-title">第 ${item.episodeIndex + 1} 集</div>
                                <div class="downloads-item-status ${item.status === 'error' ? 'is-error' : ''}" title="${escapeHtml(item.error || '')}">${escapeHtml(status)}</div>
                                ${item.status !== 'done' ? `<div class="downloads-progress"><span style="width:${percent}%"></span></div>` : ''}
                            </div>
                            ${toggle}
                            <button type="button" data-action="remove" class="downloads-remove" aria-label="删除">删除</button>
                        </div>`;
                    }).join('')}
                </section>`).join('');
        }

        list.addEventListener('click', async event => {
            const seriesButton = event.target.closest('[data-series-action]');
            if (seriesButton) {
                const section = seriesButton.closest('.downloads-group');
                const title = section.querySelector('h4').textContent;
                if (confirm(`删除《${title}》的全部下载内容？`)) {
                    await downloads.removeSeries(section.dataset.series);
                    refreshUsage();
                }
                return;
            }
            const button = event.target.closest('[data-action]');
            const row = event.target.closest('.downloads-item');
            if (!button || !row) return;
            const id = row.dataset.id;
            const action = button.dataset.action;
            if (action === 'play') downloads.play(id);
            if (action === 'pause') downloads.pause(id);
            if (action === 'resume') downloads.resume(id);
            if (action === 'remove' && confirm('删除这一集的下载内容？')) {
                await downloads.remove(id);
                refreshUsage();
            }
        });

        // 下载进度更新频繁，合并为每 300ms 最多渲染一次；最后一次变化（如下载完成）一定会渲染
        let renderTimer = null;
        downloads.onChange(() => {
            if (renderTimer) return;
            renderTimer = setTimeout(() => {
                renderTimer = null;
                render();
                if (panel.classList.contains('show')) scheduleUsage();
            }, 300);
        });
    }

    function addToDownloads(series, picked) {
        const added = downloads.add(series, picked);
        showToast(added ? `已加入下载 ${added} 集` : '已在下载列表中', added ? 'success' : 'info');
    }

    // ---- 首页详情：缓存全部剧集 ----
    function attachToDetail(container, series) {
        const copyButton = container.querySelector('button[onclick="copyLinks()"]');
        if (!copyButton || !series.episodes || !series.episodes.length) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center gap-2';
        copyButton.replaceWith(wrapper);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'px-3 py-1.5 bg-[#333] hover:bg-[#444] rounded text-sm transition-colors flex items-center gap-1 download-cache-btn';
        button.innerHTML = `${ICON_DOWNLOAD}<span>缓存全部</span>`;
        button.addEventListener('click', () => addToDownloads(
            { title: series.title, vodId: series.vodId || '', sourceCode: series.sourceCode || '', episodes: series.episodes.slice() },
            series.episodes.map((url, episodeIndex) => ({ url, episodeIndex }))
        ));
        wrapper.append(button, copyButton);
    }
    window.OfflineDownloadsUI = { attachToDetail };

    // ---- 播放页：缓存按钮 ----
    function setupPlayerButton() {
        const lockButton = document.getElementById('lockToggle');
        if (!lockButton) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('offline') === '1') return; // 离线播放时不再提供缓存

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'px-3 py-1 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition flex items-center gap-1 flex-shrink-0 download-cache-btn';
        button.innerHTML = `${ICON_DOWNLOAD}<span>缓存</span>`;
        lockButton.parentElement.style.position = 'relative';
        lockButton.parentElement.insertBefore(button, lockButton);

        const menu = document.createElement('div');
        menu.className = 'download-menu';
        menu.innerHTML = `
            <button type="button" data-scope="current">缓存本集</button>
            <button type="button" data-scope="all">缓存全部剧集</button>`;
        button.after(menu);

        button.addEventListener('click', event => {
            event.stopPropagation();
            menu.classList.toggle('show');
        });
        document.addEventListener('click', () => menu.classList.remove('show'));

        menu.addEventListener('click', event => {
            const scope = event.target.closest('[data-scope]')?.dataset.scope;
            if (!scope) return;
            menu.classList.remove('show');
            const episodes = (typeof currentEpisodes !== 'undefined' && currentEpisodes.length) ? currentEpisodes : [currentVideoUrl];
            const picked = scope === 'all'
                ? episodes.map((url, episodeIndex) => ({ url, episodeIndex }))
                : [{ url: episodes[currentEpisodeIndex] || currentVideoUrl, episodeIndex: currentEpisodeIndex }];
            addToDownloads({
                title: currentVideoTitle,
                vodId: params.get('id') || '',
                sourceCode: params.get('source') || '',
                episodes
            }, picked);
        });
    }

    // 每集下载结束时提示
    window.addEventListener('offlinedownload', event => {
        const { item, ok } = event.detail;
        const name = `《${item.title}》第 ${item.episodeIndex + 1} 集`;
        showToast(ok ? `${name}已下载完成` : `${name}下载失败：${item.error || '网络错误'}`, ok ? 'success' : 'error');
    });

    document.addEventListener('DOMContentLoaded', () => {
        setupDownloadsPanel();
        setupPlayerButton();
    });
})();
