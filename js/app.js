// 全局变量
const DEFAULT_SELECTED_APIS = ['dyttzy', 'bfzy', 'ruyi', 'jisu'];
// 已删除的内置源（失效后从 API_SITES 移除）不再保留在选择中
let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || JSON.stringify(DEFAULT_SELECTED_APIS))
    .filter(id => typeof id === 'string' && (id.startsWith('custom_') || API_SITES[id]));
let customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
// 添加当前视频的标题
let currentVideoTitle = '';
let currentVideoPoster = ''; // 当前详情的海报，用于观看历史与「继续观看」
// 全局变量用于倒序状态
let episodesReversed = false;

// 页面初始化
document.addEventListener('DOMContentLoaded', function () {
    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置默认API选择（如果是第一次加载）
    if (!localStorage.getItem('hasInitializedDefaults')) {
        // 默认选中资源
        selectedAPIs = [...DEFAULT_SELECTED_APIS];
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        // 默认选中过滤开关
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');

        // 默认启用豆瓣功能
        localStorage.setItem('doubanEnabled', 'true');

        // 标记已初始化默认值
        localStorage.setItem('hasInitializedDefaults', 'true');
    }

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);
});

// 设置事件监听器
function setupEventListeners() {
    // 回车搜索
    document.getElementById('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            search();
        }
    });

    // 点击外部关闭设置面板和历史记录面板（导航栏上打开面板的按钮除外）
    document.addEventListener('click', function (e) {
        if (e.target.closest('[data-action="toggleSettings"], [data-action="toggleHistory"]')) return;
        // 面板内的操作可能重新渲染列表（如删除历史记录），被点击的元素已不在页面上，不算点击外部
        if (!e.target.isConnected) return;
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.querySelector('#settingsPanel .close-btn');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            settingsPanel.classList.remove('show');
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.querySelector('#historyPanel .close-btn');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            historyPanel.classList.remove('show');
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea() {
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';

    // 恢复搜索区域的样式
    document.getElementById('searchArea').classList.add('flex-1');
    document.getElementById('searchArea').classList.remove('mb-8');
    document.getElementById('resultsArea').classList.add('hidden');

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    try {
        window.history.pushState(
            {},
            `PlayAny TV - 免费在线视频搜索与观看平台`,
            `/`
        );
        // 更新页面标题
        document.title = `PlayAny TV - 免费在线视频搜索与观看平台`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

// 搜索功能 - 修改为支持多选API和多页结果
// 搜索请求序号：发起新搜索后，之前仍在返回的结果不再显示
let searchSeq = 0;

const ADULT_TYPE_KEYWORDS = ['伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG', '网红主播', '色情片', '同性片', '福利视频', '福利片'];

function showResultsArea() {
    document.getElementById('searchArea').classList.remove('flex-1');
    document.getElementById('searchArea').classList.add('mb-8');
    document.getElementById('resultsArea').classList.remove('hidden');
    const doubanArea = document.getElementById('doubanArea');
    if (doubanArea) doubanArea.classList.add('hidden');
}

function updateSearchUrl(query) {
    try {
        window.history.pushState({ search: query }, `搜索: ${query} - PlayAny TV`, `/s=${encodeURIComponent(query)}`);
        document.title = `搜索: ${query} - PlayAny TV`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

function renderSearchProgress(done, total, skipped = 0) {
    const count = document.getElementById('searchResultsCount');
    if (!count) return;
    let progress = document.getElementById('searchProgress');
    if (!progress) {
        progress = document.createElement('span');
        progress.id = 'searchProgress';
        progress.className = 'search-progress';
        count.parentElement.prepend(progress);
    }
    const parts = [];
    if (done < total) parts.push(`正在搜索 ${done}/${total} 个源`);
    if (skipped) parts.push(`已跳过 ${skipped} 个暂不可用的源`);
    progress.textContent = parts.length ? parts.join(' · ') + ' · ' : '';
}

function renderNoResults(resultsDiv) {
    resultsDiv.innerHTML = `
        <div class="col-span-full text-center py-16">
            <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="mt-2 text-lg font-medium text-gray-400">没有找到匹配的结果</h3>
            <p class="mt-1 text-sm text-gray-500">请尝试其他关键词或更换数据源</p>
        </div>
    `;
}

function renderResultCard(item, resultIndex) {
    const vodName = (item.vod_name || '').toString();
    const safeName = escapeHtml(vodName);
    const sourceInfo = item._sources.length > 1
        ? `<span class="bg-[#222] text-xs px-1.5 py-0.5 rounded-full">${item._sources.length} 个源</span>`
        : item.source_name ? `<span class="bg-[#222] text-xs px-1.5 py-0.5 rounded-full">${escapeHtml(item.source_name)}</span>` : '';
    const coverUrl = safeHttpUrl(item.vod_pic);
    const hasCover = Boolean(coverUrl);

    return `
        <div class="card-hover bg-[#111] rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] h-full shadow-sm hover:shadow-md"
             ${actionAttrs('openSearchResult', resultIndex)}>
            <div class="flex h-full">
                ${hasCover ? `
                <div class="relative flex-shrink-0 search-card-img-container">
                    <img src="${escapeHtml(coverUrl)}" alt="${safeName}"
                         class="h-full w-full object-cover transition-transform hover:scale-110"
                         data-fallback="placeholder"
                         loading="lazy">
                    <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                </div>` : ''}

                <div class="p-2 flex flex-col flex-grow">
                    <div class="flex-grow">
                        <h3 class="font-semibold mb-2 break-words line-clamp-2 ${hasCover ? '' : 'text-center'}" title="${safeName}">${safeName}</h3>

                        <div class="flex flex-wrap ${hasCover ? '' : 'justify-center'} gap-1 mb-2">
                            ${item.type_name ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300">${escapeHtml(item.type_name)}</span>` : ''}
                            ${item.vod_year ? `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300">${escapeHtml(item.vod_year)}</span>` : ''}
                        </div>
                        <p class="text-gray-400 line-clamp-2 overflow-hidden ${hasCover ? '' : 'text-center'} mb-2">
                            ${escapeHtml(item.vod_remarks || '暂无介绍')}
                        </p>
                    </div>

                    <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-800">
                        ${sourceInfo ? `<div>${sourceInfo}</div>` : '<div></div>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

/** 渲染当前已返回的全部结果：同一部剧在多个数据源中出现时合并为一张卡片，详情中可切换数据源 */
function renderSearchResults(rawResults) {
    const merged = mergeSearchResults(rawResults);
    searchResultGroups = merged.map(item => item._sources);
    const resultCount = document.getElementById('searchResultsCount');
    if (resultCount) resultCount.textContent = merged.length;
    document.getElementById('results').innerHTML = merged.map(renderResultCard).join('');
}

/**
 * 搜索所有选中的数据源。哪个源先返回就先显示，不必等最慢的源；
 * 后返回的结果按顺序追加，同名剧集合并到已有卡片。
 */
async function search() {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('请输入搜索内容', 'info');
        return;
    }

    if (selectedAPIs.length === 0) {
        showToast('请至少选择一个API源', 'warning');
        return;
    }

    const seq = ++searchSeq;
    const filterAdult = localStorage.getItem('yellowFilterEnabled') === 'true';
    const resultsDiv = document.getElementById('results');
    // 最近连续失败的源暂时跳过（见 js/search.js）；全部都失败过时仍然全部尝试
    const available = selectedAPIs.filter(apiId => !isSourceUnavailable(apiId));
    const apiIds = available.length ? available : selectedAPIs;
    const skipped = selectedAPIs.length - apiIds.length;
    const total = apiIds.length;
    let allResults = [];
    let done = 0;
    let shown = false;

    saveSearchHistory(query);
    showLoading();

    await Promise.all(apiIds.map(async apiId => {
        let results = await searchByAPIAndKeyWord(apiId, query);
        if (seq !== searchSeq) return;
        done++;
        if (filterAdult) {
            results = results.filter(item => !ADULT_TYPE_KEYWORDS.some(keyword => (item.type_name || '').includes(keyword)));
        }
        if (results.length) {
            allResults = allResults.concat(results);
            if (!shown) {
                shown = true;
                hideLoading();
                showResultsArea();
                updateSearchUrl(query);
            }
            renderSearchResults(allResults);
        }
        if (shown) renderSearchProgress(done, total, skipped);
    }));

    if (seq !== searchSeq) return;
    if (!shown) {
        hideLoading();
        showResultsArea();
        document.getElementById('searchResultsCount').textContent = '0';
        renderSearchProgress(done, total, skipped);
        renderNoResults(resultsDiv);
    }
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', () => {
    hookInput();
    document.getElementById('searchInput').addEventListener('input', toggleClearButton);
});

// 显示详情 - 修改为支持自定义API
// ---- 搜索结果合并 ----
// 每张卡片对应的数据源列表（[{ id, name, code, sourceName }]），供详情中的数据源切换使用
let searchResultGroups = [];
let currentDetailSources = [];

function normalizeTitle(title) {
    return String(title || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

// 按「名称 + 年份」合并结果；保留第一次出现的条目作为卡片内容，_sources 记录所有数据源
function mergeSearchResults(results) {
    const groups = new Map();
    results.forEach(item => {
        const key = `${normalizeTitle(item.vod_name)}|${item.vod_year || ''}`;
        const source = { id: item.vod_id, name: item.vod_name, code: item.source_code || '', sourceName: item.source_name || '' };
        if (groups.has(key)) groups.get(key)._sources.push(source);
        else groups.set(key, { ...item, _sources: [source] });
    });
    return [...groups.values()];
}

function openSearchResult(index) {
    const sources = searchResultGroups[index] || [];
    if (!sources.length) return;
    currentDetailSources = sources;
    showDetails(sources[0].id, sources[0].name, sources[0].code);
}

// 详情顶部的数据源切换（只有一个数据源时不显示）
function renderSourceSwitcher(container, id, sourceCode) {
    const sources = currentDetailSources;
    if (sources.length < 2 || !sources.some(s => String(s.id) === String(id) && s.code === sourceCode)) return;
    const bar = document.createElement('div');
    bar.className = 'source-switcher';
    bar.innerHTML = `<span class="source-switcher-label">数据源</span>` + sources.map((s, i) => `
        <button type="button" data-index="${i}" class="${String(s.id) === String(id) && s.code === sourceCode ? 'is-active' : ''}">${escapeHtml(s.sourceName || s.code)}</button>`).join('');
    bar.addEventListener('click', event => {
        const button = event.target.closest('button[data-index]');
        if (!button || button.classList.contains('is-active')) return;
        const s = sources[Number(button.dataset.index)];
        showDetails(s.id, s.name, s.code);
    });
    container.prepend(bar);
}

async function showDetails(id, vod_name, sourceCode) {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }
    if (!id) {
        showToast('视频ID无效', 'error');
        return;
    }

    showLoading();
    try {
        const data = await fetchVideoDetail(id, sourceCode);

        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');

        // 显示来源信息
        const sourceName = data.videoInfo && data.videoInfo.source_name ?
            ` <span class="text-sm font-normal text-gray-400">(${escapeHtml(data.videoInfo.source_name)})</span>` : '';

        // 不对标题进行截断处理，允许完整显示
        modalTitle.innerHTML = `<span class="break-words">${escapeHtml(vod_name || '未知视频')}</span>${sourceName}`;
        currentVideoTitle = vod_name || '未知视频';

        if (data.episodes && data.episodes.length > 0) {
            // 构建详情信息HTML
            let detailInfoHtml = '';
            if (data.videoInfo) {
                // 数据源的简介常含 HTML 标签与实体（如 &nbsp;）：用 DOMParser 取纯文本（不会执行脚本），输出时再转义
                const descriptionText = data.videoInfo.desc
                    ? (new DOMParser().parseFromString(String(data.videoInfo.desc), 'text/html').body.textContent || '').replace(/\u00a0/g, ' ').trim()
                    : '';

                // Check if there's any actual grid content
                const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                if (hasGridContent || descriptionText) { // Only build if there's something to show
                    detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${data.videoInfo.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${escapeHtml(data.videoInfo.type)}</span></div>` : ''}
                        ${data.videoInfo.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${escapeHtml(data.videoInfo.year)}</span></div>` : ''}
                        ${data.videoInfo.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${escapeHtml(data.videoInfo.area)}</span></div>` : ''}
                        ${data.videoInfo.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${escapeHtml(data.videoInfo.director)}</span></div>` : ''}
                        ${data.videoInfo.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${escapeHtml(data.videoInfo.actor)}</span></div>` : ''}
                        ${data.videoInfo.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${escapeHtml(data.videoInfo.remarks)}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${escapeHtml(descriptionText)}</p>
                    </div>` : ''}
                </div>
                `;
                }
            }

            currentEpisodes = data.episodes;
            currentEpisodeIndex = 0;
            currentVideoPoster = safeHttpUrl(data.videoInfo && data.videoInfo.cover);

            modalContent.innerHTML = `
                ${detailInfoHtml}
                <div class="flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="flex items-center gap-2">
                        <button id="episodeOrderToggle" ${actionAttrs('toggleEpisodeOrder', sourceCode, id)} 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span class="text-gray-400 text-sm">共 ${data.episodes.length} 集</span>
                    </div>
                    <button data-action="copyLinks" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
            // App 内在详情中提供「缓存全部」（见 js/downloads-ui.js）
            if (window.OfflineDownloadsUI) {
                window.OfflineDownloadsUI.attachToDetail(modalContent, { title: vod_name, vodId: id, sourceCode, episodes: currentEpisodes });
            }
        } else {
            modalContent.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
        }
        renderSourceSwitcher(modalContent, id, sourceCode);

        modal.classList.remove('hidden');
    } catch (error) {
        console.error('获取详情错误:', error);
        showToast('获取详情失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }

    // 获取当前路径作为返回页面
    let currentPath = window.location.href;

    // 构建播放页面URL，使用watch.html作为中间跳转页
    let watchUrl = `watch.html?id=${vodId || ''}&source=${sourceCode || ''}&url=${encodeURIComponent(url)}&index=${episodeIndex}&title=${encodeURIComponent(vod_name || '')}`;

    // 添加返回URL参数
    if (currentPath.includes('index.html') || currentPath.endsWith('/')) {
        watchUrl += `&back=${encodeURIComponent(currentPath)}`;
    }

    // 保存当前状态到localStorage
    try {
        localStorage.setItem('currentVideoTitle', vod_name || '未知视频');
        localStorage.setItem('currentVideoPoster', currentVideoPoster);
        localStorage.setItem('currentEpisodes', JSON.stringify(currentEpisodes));
        localStorage.setItem('currentEpisodeIndex', episodeIndex);
        localStorage.setItem('currentSourceCode', sourceCode || '');
        localStorage.setItem('lastPlayTime', Date.now());
        localStorage.setItem('lastSearchPage', currentPath);
        localStorage.setItem('lastPageUrl', currentPath);  // 确保保存返回页面URL
    } catch (e) {
        console.error('保存播放状态失败:', e);
    }

    // 在当前标签页中打开播放页面
    window.location.href = watchUrl;
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // App 内 Capacitor 只向主页面注入原生桥，iframe 里的播放页会退化成网页版，所以直接跳转
    if (document.documentElement.classList.contains('native-app')) {
        window.location.href = url;
        return;
    }
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = currentEpisodes[prevIndex];
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = currentEpisodes[nextIndex];
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        return `
            <button id="episode-${realIndex}" ${actionAttrs('playVideo', episode, vodName, sourceCode, realIndex, vodId)} 
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    }).join('');
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes.join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.getElementById('episodeOrderToggle');
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}
