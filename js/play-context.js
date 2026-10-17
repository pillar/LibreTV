// 打开播放页（首页的详情 / 观看历史 / 继续观看、播放页的切换数据源、离线缓存共用）。
// 播放页以网址参数为准：source（数据源键）+ id 确定一部剧，index / url 为当前集，position 为续播位置（秒），
// back 为返回地址；离线播放另有 offline=1 与 series（离线缓存的剧集键）。
// 剧集列表、标题与海报放在 sessionStorage（每个标签页独立，多个标签页播放不同的剧互不覆盖）；
// 播放页取不到时（例如在新标签页打开、从观看历史进入）按 source + id 重新获取详情，见 js/player.js。

const PLAY_CONTEXT_PREFIX = 'playContext:';

function playContextKey({ source, id, series }) {
    return PLAY_CONTEXT_PREFIX + (series ? `offline:${series}` : `${source || ''}:${id || ''}`);
}

/** 读取 openPlayer 保存的剧集信息，没有时为 null */
function readPlayContext(params) {
    try {
        const context = JSON.parse(sessionStorage.getItem(playContextKey(params)) || 'null');
        return context && Array.isArray(context.episodes) ? context : null;
    } catch {
        return null;
    }
}

function buildPlayerUrl(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    return `player.html?${search}`;
}

/**
 * 跳转到播放页。params 见文件开头；context 为 { title, poster, episodes, refresh }（可省略；refresh 表示列表可能过时，播放页会重新获取）。
 * 未指定 back 时返回当前页；从播放页再打开播放页（换源、播放离线缓存）时沿用原来的返回地址。
 */
function openPlayer(params, context) {
    if (context) {
        try {
            sessionStorage.setItem(playContextKey(params), JSON.stringify(context));
        } catch {
            // 存储不可用时，播放页会重新获取详情
        }
    }
    // 网页版的 /player.html 会被重定向为 /player
    const onPlayer = /\/player(\.html)?$/.test(window.location.pathname);
    const back = onPlayer ? new URLSearchParams(window.location.search).get('back') || '' : window.location.href;
    window.location.href = buildPlayerUrl({ back, ...params });
}
