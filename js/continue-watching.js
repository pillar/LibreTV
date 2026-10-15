// 首页「继续观看」：根据观看历史（ui.js 的 getViewingHistory）展示最近看过的剧，点击从上次的位置继续播放。
// 只在首页、且没有显示搜索结果时出现；观看历史变化（播放、删除、清空）时自动刷新。
(function () {
    const MAX_ITEMS = 12;

    function formatRemaining(item) {
        const left = (Number(item.duration) || 0) - (Number(item.playbackPosition) || 0);
        if (!item.duration || left <= 0) return '';
        return left >= 3600 ? `剩 ${Math.floor(left / 3600)} 小时 ${Math.round(left % 3600 / 60)} 分` : `剩 ${Math.max(1, Math.round(left / 60))} 分钟`;
    }

    function render() {
        const section = document.getElementById('continueWatching');
        const results = document.getElementById('resultsArea');
        if (!section) return;
        const history = (typeof getViewingHistory === 'function' ? getViewingHistory() : [])
            .filter(item => item && item.url && item.title)
            .slice(0, MAX_ITEMS);
        const searching = results && !results.classList.contains('hidden');
        section.classList.toggle('hidden', !history.length || searching || !isPasswordVerified());
        if (!history.length) return;

        section.querySelector('.cw-row').innerHTML = history.map((item, index) => {
            const episode = Number(item.episodeIndex) || 0;
            const percent = item.duration ? Math.min(100, Math.round((Number(item.playbackPosition) || 0) / item.duration * 100)) : 0;
            const poster = safeHttpUrl(item.poster);
            const meta = [item.episodes && item.episodes.length > 1 ? `第 ${episode + 1} 集` : '', formatRemaining(item)].filter(Boolean).join(' · ');
            return `
                <button type="button" class="cw-card" data-index="${index}" title="${escapeHtml(item.title)}">
                    <span class="cw-poster">
                        ${poster
                            ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
                            : ''}
                        <span class="cw-initial">${escapeHtml(item.title.trim().charAt(0))}</span>
                        <span class="cw-progress"><span style="width:${percent}%"></span></span>
                    </span>
                    <span class="cw-title">${escapeHtml(item.title)}</span>
                    <span class="cw-meta">${escapeHtml(meta || item.sourceName || '')}</span>
                </button>`;
        }).join('');

        section.querySelectorAll('.cw-card').forEach(card => {
            card.addEventListener('click', () => {
                const item = history[Number(card.dataset.index)];
                playFromHistory(item.url, item.title, Number(item.episodeIndex) || 0, Number(item.playbackPosition) || 0);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('continueWatching')) return;
        render();
        // 搜索结果出现/隐藏时同步显示状态
        const results = document.getElementById('resultsArea');
        if (results) new MutationObserver(render).observe(results, { attributes: true, attributeFilter: ['class'] });
    });
    window.addEventListener('viewinghistorychange', render);
    document.addEventListener('passwordVerified', render);
    // 从播放页返回（浏览器往返缓存）时刷新进度
    window.addEventListener('pageshow', event => { if (event.persisted) render(); });
})();
