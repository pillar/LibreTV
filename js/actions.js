// 页面交互的统一入口：元素上写 data-action="函数名"（参数放在 data-args，JSON 数组），点击时调用同名全局函数。
// 取代内联的 onclick 等属性，使页面可以启用禁止内联脚本的 CSP（见 lib/handler.mjs）。
// 只处理 ACTIONS 中列出的函数（其他 data-action 由各自的模块处理）；带 data-pass-event 的元素把点击事件作为第一个参数。

const ACTIONS = new Set([
    // 首页
    'resetToHome', 'toggleHistory', 'toggleSettings', 'clearViewingHistory', 'selectAllAPIs',
    'showAddCustomApiForm', 'addCustomApi', 'cancelAddCustomApi', 'editCustomApi', 'removeCustomApi',
    'updateCustomApi', 'cancelEditCustomApi', 'importConfig', 'exportConfig', 'importConfigFromUrl',
    'clearLocalStorage', 'clearSearchInput', 'search', 'clearSearchHistory', 'openSearchResult',
    'closeModal', 'playVideo', 'copyLinks', 'toggleEpisodeOrder', 'playFromHistory', 'deleteHistoryItem',
    'fillAndSearchWithDouban', 'retryDoubanRecommend', 'openShortDrama',
    // 播放页
    'goBack', 'playPreviousEpisode', 'playNextEpisode', 'toggleControlsLock', 'playEpisode',
    'showSwitchResourceModal', 'switchToResource'
]);

/** 生成元素属性：data-action 与 data-args（已转义，可直接写入 HTML 模板） */
function actionAttrs(name, ...args) {
    const argsAttr = args.length ? ` data-args="${escapeHtml(JSON.stringify(args))}"` : '';
    return `data-action="${name}"${argsAttr}`;
}

document.addEventListener('click', event => {
    // 链接（没有 data-action）位于可点击的卡片内时，点击链接只打开链接
    const target = event.target.closest('[data-action], a[href]');
    if (!target || !target.dataset.action) return;
    const name = target.dataset.action;
    if (!ACTIONS.has(name)) return;
    const fn = window[name];
    if (typeof fn !== 'function') {
        console.error('页面操作未定义:', name);
        return;
    }
    if (target.tagName === 'A') event.preventDefault();
    let args = [];
    try {
        args = target.dataset.args ? JSON.parse(target.dataset.args) : [];
    } catch (error) {
        console.error('页面操作参数无效:', name, error);
        return;
    }
    if ('passEvent' in target.dataset) args.unshift(event);
    fn(...args);
});

// 图片加载失败：data-fallback="remove" 移除图片，"placeholder" 换成本地占位图（只替换一次）
document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
    if (img.dataset.fallback === 'remove') {
        img.remove();
    } else if (img.dataset.fallback === 'placeholder' && !img.dataset.fallbackApplied) {
        img.dataset.fallbackApplied = '1';
        img.src = 'image/no-cover.svg';
        img.classList.add('object-contain');
    }
}, true);
