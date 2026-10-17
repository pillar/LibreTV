// 首页「短剧」频道（与豆瓣电影 / 电视剧共用 #doubanArea，切换见 js/douban.js）。
// 内容取自 SHORT_DRAMA_SOURCES 中各资源站的短剧分类（配置见 js/config.js），多个站的同名剧合并为一张卡片，
// 点击后打开详情，可在各站之间切换。

const SHORT_DRAMA_CLASSES_KEY = 'shortDramaClasses';
const SHORT_DRAMA_CLASSES_TTL = 24 * 60 * 60 * 1000;
const SHORT_DRAMA_TIMEOUT = 10000;
const SHORT_DRAMA_LATEST = '最新';
const SHORT_DRAMA_MAX_CARDS = 30;
// 每个分类每次取的条数（支持 pagesize 参数的站点按此返回，可减少一半以上的数据量；不支持的站点仍返回 20 条）
const SHORT_DRAMA_PAGE_SIZE = 8;

// 当前显示的卡片对应的数据源列表（点击卡片时用）
let shortDramaGroups = [];

function shortDramaTags() {
    return [SHORT_DRAMA_LATEST, ...SHORT_DRAMA_GENRES.map(genre => genre.name)];
}

async function fetchShortDramaJson(url) {
    const response = await fetch(PROXY_URL + encodeURIComponent(url), {
        headers: API_CONFIG.search.headers,
        signal: AbortSignal.timeout(SHORT_DRAMA_TIMEOUT)
    });
    if (!response.ok) throw new Error(`请求失败: ${response.status}`);
    return response.json();
}

/**
 * 从资源站的分类列表中识别短剧分类：
 * latest 为名称含「短剧」的顶层分类；genres 为题材标签 → 分类编号（短剧分类下的子分类，以及名称含 AI 的短剧分类）。
 */
function classifyShortDramaClasses(classes) {
    const usable = classes.filter(c => c && c.type_name && !c.type_name.includes('擦边'));
    const shortIds = new Set(usable.filter(c => c.type_name.includes('短剧')).map(c => String(c.type_id)));
    const latest = usable
        .filter(c => shortIds.has(String(c.type_id)) && !shortIds.has(String(c.type_pid)))
        .map(c => c.type_id);
    const genres = {};
    const aiGenre = SHORT_DRAMA_GENRES.find(genre => genre.keywords.includes('ai'));
    for (const c of usable) {
        const isChild = shortIds.has(String(c.type_pid));
        const name = c.type_name.toLowerCase();
        const isAi = name.includes('ai');
        if (!isChild && !(isAi && shortIds.has(String(c.type_id)))) continue;
        // AI 优先判断，避免「AI 爽剧」之类被归入其他题材
        const genre = isAi ? aiGenre : SHORT_DRAMA_GENRES.find(g => g !== aiGenre && g.keywords.some(k => name.includes(k)));
        if (genre) (genres[genre.name] = genres[genre.name] || []).push(c.type_id);
    }
    return { latest, genres };
}

/** 各资源站的短剧分类（本机缓存一天，分类编号很少变化） */
async function shortDramaClassesOf(apiId) {
    const api = API_SITES[apiId].api;
    let cache = {};
    try {
        cache = JSON.parse(localStorage.getItem(SHORT_DRAMA_CLASSES_KEY) || '{}') || {};
    } catch {
        cache = {};
    }
    const cached = cache[api];
    if (cached && Date.now() - cached.at < SHORT_DRAMA_CLASSES_TTL) return cached;

    const data = await fetchShortDramaJson(`${api}?ac=list`);
    if (!data || !Array.isArray(data.class)) throw new Error('分类列表无效');
    const entry = { at: Date.now(), ...classifyShortDramaClasses(data.class) };
    cache[api] = entry;
    try {
        localStorage.setItem(SHORT_DRAMA_CLASSES_KEY, JSON.stringify(cache));
    } catch {
        // 存储不可用时只是不缓存
    }
    return entry;
}

/** 某个资源站某个标签第 page 页的短剧（失败时为空） */
async function fetchShortDramaSource(apiId, tag, page) {
    try {
        const classes = await shortDramaClassesOf(apiId);
        const typeIds = tag === SHORT_DRAMA_LATEST ? classes.latest : (classes.genres[tag] || []);
        const pages = await Promise.all(typeIds.map(async typeId => {
            const data = await fetchShortDramaJson(`${API_SITES[apiId].api}?ac=videolist&t=${encodeURIComponent(typeId)}&pg=${page}&pagesize=${SHORT_DRAMA_PAGE_SIZE}`);
            return Array.isArray(data && data.list) ? data.list : [];
        }));
        return pages.flat()
            .filter(item => item && item.vod_id && item.vod_name)
            .map(item => ({ ...item, source_code: apiId, source_name: API_SITES[apiId].name }));
    } catch (error) {
        console.warn(`${API_SITES[apiId].name} 短剧获取失败:`, error);
        return [];
    }
}

/**
 * 某个标签第 page 页：各资源站对应分类的结果合并（同名剧合并为一项）。
 * 哪个站先返回就先显示：每个站返回后都以目前已返回的结果调用 onUpdate(groups, finished)。
 */
async function fetchShortDramaPage(tag, page, onUpdate) {
    const sources = SHORT_DRAMA_SOURCES.filter(apiId => API_SITES[apiId] && !isSourceUnavailable(apiId));
    // 各站内部按更新时间排序后轮流取，避免更新最频繁的一个站占满整页；按配置顺序轮流，结果不受返回先后影响
    const byTime = (a, b) => String(b.vod_time || '').localeCompare(String(a.vod_time || ''));
    const queues = sources.map(() => []);
    let pending = sources.length;
    const merged = () => {
        const items = [];
        for (let i = 0; queues.some(queue => i < queue.length); i++) {
            for (const queue of queues) if (i < queue.length) items.push(queue[i]);
        }
        return mergeSearchResults(items).slice(0, SHORT_DRAMA_MAX_CARDS);
    };
    if (!pending) onUpdate([], true);
    await Promise.all(sources.map(async (apiId, index) => {
        queues[index] = (await fetchShortDramaSource(apiId, tag, page)).sort(byTime);
        pending--;
        onUpdate(merged(), pending === 0);
    }));
}

function renderShortDramaCards(groups, container) {
    shortDramaGroups = groups.map(item => item._sources);
    if (!groups.length) {
        container.innerHTML = `
            <div class="col-span-full text-center py-8">
                <div class="text-ink-2">暂无短剧，请换个标签或稍后再试</div>
                <button type="button" class="douban-retry mt-3" data-action="retryDoubanRecommend">重试</button>
            </div>
        `;
        return;
    }
    container.innerHTML = groups.map((item, index) => {
        const safeTitle = escapeHtml(item.vod_name);
        const cover = safeHttpUrl(item.vod_pic);
        const badge = item._sources.length > 1 ? `${item._sources.length} 个源` : item.source_name;
        return `
            <div class="douban-card short-drama-card bg-surface rounded-lg overflow-hidden flex flex-col cursor-pointer shadow-md"
                 ${actionAttrs('openShortDrama', index)}>
                <div class="douban-cover-wrap relative w-full aspect-[2/3] overflow-hidden">
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="${safeTitle}" class="douban-cover w-full h-full object-cover"
                        loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                    ${item.vod_remarks ? `<div class="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">${escapeHtml(item.vod_remarks)}</div>` : ''}
                    <div class="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">${escapeHtml(badge)}</div>
                </div>
                <div class="p-2 text-center bg-surface">
                    <div class="text-sm font-medium text-white truncate" title="${safeTitle}">${safeTitle}</div>
                </div>
            </div>
        `;
    }).join('');
}

/** 由 renderRecommend 在短剧模式下调用；requestSeq 用于丢弃切换标签前的旧请求结果 */
async function renderShortDrama(tag, page, container, requestSeq) {
    await fetchShortDramaPage(tag, page, (groups, finished) => {
        if (requestSeq !== doubanRequestSeq) return;
        // 还有站点未返回时，空结果先不显示「暂无短剧」，继续显示加载中
        if (groups.length || finished) renderShortDramaCards(groups, container);
    });
}

function openShortDrama(index) {
    const sources = shortDramaGroups[index] || [];
    if (!sources.length) return;
    currentDetailSources = sources;
    showDetails(sources[0].id, sources[0].name, sources[0].code);
}
