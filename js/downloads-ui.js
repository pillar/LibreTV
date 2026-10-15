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
            <div class="downloads-footer"></div>`;
        document.body.appendChild(panel);
        const list = panel.querySelector('.downloads-list');
        const footer = panel.querySelector('.downloads-footer');

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
        panel.querySelector('.downloads-close').addEventListener('click', close);
        window.addEventListener('nativeback', event => {
            if (panel.classList.contains('show')) {
                event.preventDefault();
                close();
            }
        });

        async function refreshUsage() {
            const count = downloads.list().filter(item => item.status === 'done').length;
            footer.textContent = `已下载 ${count} 集 · 占用 ${formatBytes(await downloads.usage())}`;
        }

        function render() {
            if (!panel.classList.contains('show')) return;
            const items = downloads.list();
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
                <section class="downloads-group">
                    <h4>${escapeHtml(group[0].title)}</h4>
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

        let lastRender = 0;
        downloads.onChange(() => {
            // 下载进度更新频繁，渲染限制为每 300ms 一次
            const now = Date.now();
            if (now - lastRender < 300) return;
            lastRender = now;
            render();
        });
    }

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
            const added = downloads.add({
                title: currentVideoTitle,
                vodId: params.get('id') || '',
                sourceCode: params.get('source') || '',
                episodes
            }, picked);
            showToast(added ? `已加入下载 ${added} 集` : '已在下载列表中', added ? 'success' : 'info');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        setupDownloadsPanel();
        setupPlayerButton();
    });
})();
