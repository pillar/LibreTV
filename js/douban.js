// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表 - 修改为默认标签
let defaultMovieTags = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
let defaultTvTags = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

// 用户标签列表 - 存储用户实际使用的标签（包含保留的系统标签和用户添加的自定义标签）
let movieTags = [];
let tvTags = [];

// 加载用户标签
function loadUserTags() {
    try {
        // 尝试从本地存储加载用户保存的标签
        const savedMovieTags = localStorage.getItem('userMovieTags');
        const savedTvTags = localStorage.getItem('userTvTags');
        
        // 如果本地存储中有标签数据，则使用它
        if (savedMovieTags) {
            movieTags = JSON.parse(savedMovieTags);
        } else {
            // 否则使用默认标签
            movieTags = [...defaultMovieTags];
        }
        
        if (savedTvTags) {
            tvTags = JSON.parse(savedTvTags);
        } else {
            // 否则使用默认标签
            tvTags = [...defaultTvTags];
        }
    } catch (e) {
        console.error('加载标签失败：', e);
        // 初始化为默认值，防止错误
        movieTags = [...defaultMovieTags];
        tvTags = [...defaultTvTags];
    }
}

// 保存用户标签
function saveUserTags() {
    try {
        localStorage.setItem('userMovieTags', JSON.stringify(movieTags));
        localStorage.setItem('userTvTags', JSON.stringify(tvTags));
    } catch (e) {
        console.error('保存标签失败：', e);
        showToast('保存标签失败', 'error');
    }
}

let doubanMovieTvCurrentSwitch = 'movie';
let doubanCurrentTag = '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量

// 初始化豆瓣功能
function initDouban() {
    // 设置豆瓣开关的初始状态
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
        doubanToggle.checked = isEnabled;
        
        // 设置开关外观
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg.nextElementSibling;
        if (isEnabled) {
            toggleBg.classList.add('bg-pink-600');
            toggleDot.classList.add('translate-x-6');
        }
        
        // 添加事件监听
        doubanToggle.addEventListener('change', function(e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);
            
            // 更新开关外观
            if (isChecked) {
                toggleBg.classList.add('bg-pink-600');
                toggleDot.classList.add('translate-x-6');
            } else {
                toggleBg.classList.remove('bg-pink-600');
                toggleDot.classList.remove('translate-x-6');
            }
            
            // 更新显示状态
            updateDoubanVisibility();
        });
        
        // 初始更新显示状态
        updateDoubanVisibility();

        // 滚动到页面顶部
        window.scrollTo(0, 0);
    }

    // 加载用户标签
    loadUserTags();

    // 渲染电影/电视剧切换
    renderDoubanMovieTvSwitch();
    
    // 渲染豆瓣标签
    renderDoubanTags();
    
    // 换一批按钮事件监听
    setupDoubanRefreshBtn();
    // 热门内容由上面的 updateDoubanVisibility() 在列表为空时加载，这里不再重复请求
}

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;
    
    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    const isSearching = document.getElementById('resultsArea') && 
        !document.getElementById('resultsArea').classList.contains('hidden');
    
    // 只有在启用且没有搜索结果显示时才显示豆瓣区域
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        // 如果豆瓣结果为空，重新加载
        if (document.getElementById('douban-results').children.length === 0) {
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
    } else {
        doubanArea.classList.add('hidden');
    }
}

// 只填充搜索框，不执行搜索，让用户自主决定搜索时机
function fillSearchInput(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        
        // 聚焦搜索框，便于用户立即使用键盘操作
        input.focus();
        
        // 显示一个提示，告知用户点击搜索按钮进行搜索
        showToast('已填充搜索内容，点击搜索按钮开始搜索', 'info');
    }
}

// 填充搜索框并执行搜索
function fillAndSearch(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        search(); // 使用已有的search函数执行搜索
        
        // 同时更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - PlayAny TV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - PlayAny TV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }
    }
}

// 填充搜索框并执行搜索
async function fillAndSearchWithDouban(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    // 填充搜索框并执行搜索
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        await search(); // 使用已有的search函数执行搜索
        
        // 更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - PlayAny TV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - PlayAny TV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        if (window.innerWidth <= 768) {
          window.scrollTo({
              top: 0,
              behavior: 'smooth'
          });
        }
    }
}

// 渲染电影 / 电视剧 / 短剧切换器（短剧内容来自资源站，见 js/short-drama.js）
const DOUBAN_MODES = [
    { mode: 'movie', button: 'douban-movie-toggle', title: '豆瓣热门' },
    { mode: 'tv', button: 'douban-tv-toggle', title: '豆瓣热门' },
    { mode: 'short', button: 'douban-short-toggle', title: '热门短剧' }
];

function setDoubanMode(mode) {
    if (doubanMovieTvCurrentSwitch === mode) return;
    doubanMovieTvCurrentSwitch = mode;
    for (const item of DOUBAN_MODES) {
        const button = document.getElementById(item.button);
        if (!button) continue;
        const active = item.mode === mode;
        button.classList.toggle('bg-pink-600', active);
        button.classList.toggle('text-white', active);
        button.classList.toggle('text-gray-300', !active);
        if (active) {
            const title = document.getElementById('douban-title');
            if (title) title.textContent = item.title;
        }
    }
    doubanCurrentTag = mode === 'short' ? SHORT_DRAMA_LATEST : '热门';
    doubanPageStart = 0;
    renderDoubanTags();
    setupDoubanRefreshBtn();
    if (localStorage.getItem('doubanEnabled') === 'true') {
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    }
}

function renderDoubanMovieTvSwitch() {
    for (const item of DOUBAN_MODES) {
        const button = document.getElementById(item.button);
        if (button) button.addEventListener('click', () => setDoubanMode(item.mode));
    }
}

// 渲染豆瓣标签选择器
function renderDoubanTags(tags) {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;
    
    // 确定当前应该使用的标签列表（短剧的标签固定，不可管理）
    const isShort = doubanMovieTvCurrentSwitch === 'short';
    const currentTags = isShort ? shortDramaTags() : doubanMovieTvCurrentSwitch === 'movie' ? movieTags : tvTags;
    
    // 清空标签容器
    tagContainer.innerHTML = '';

    // 先添加标签管理按钮
    if (!isShort) {
        const manageBtn = document.createElement('button');
        manageBtn.className = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border border-[#333] hover:border-white';
        manageBtn.innerHTML = '<span class="flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>管理标签</span>';
        manageBtn.onclick = function() {
            showTagManageModal();
        };
        tagContainer.appendChild(manageBtn);
    }

    // 添加所有标签
    currentTags.forEach(tag => {
        const btn = document.createElement('button');
        
        // 设置样式
        let btnClass = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 border ';
        
        // 当前选中的标签使用高亮样式
        if (tag === doubanCurrentTag) {
            btnClass += 'bg-pink-600 text-white shadow-md border-white';
        } else {
            btnClass += 'bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border-[#333] hover:border-white';
        }
        
        btn.className = btnClass;
        btn.textContent = tag;
        
        btn.onclick = function() {
            if (doubanCurrentTag !== tag) {
                doubanCurrentTag = tag;
                doubanPageStart = 0;
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
                renderDoubanTags();
            }
        };
        
        tagContainer.appendChild(btn);
    });
}

// 设置换一批按钮事件
function setupDoubanRefreshBtn() {
    // 修复ID，使用正确的ID douban-refresh 而不是 douban-refresh-btn
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;
    
    btn.onclick = function() {
        doubanPageStart += doubanPageSize;
        if (doubanPageStart > 9 * doubanPageSize) {
            doubanPageStart = 0;
        }
        
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    };
}

function fetchDoubanTags() {
    const movieTagsTarget = `https://movie.douban.com/j/search_tags?type=movie`
    fetchDoubanData(movieTagsTarget)
        .then(data => {
            movieTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'movie') {
                renderDoubanTags(movieTags);
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电影标签失败：", error);
        });
    const tvTagsTarget = `https://movie.douban.com/j/search_tags?type=tv`
    fetchDoubanData(tvTagsTarget)
       .then(data => {
            tvTags = data.tags;
            if (doubanMovieTvCurrentSwitch === 'tv') {
                renderDoubanTags(tvTags);
            }
        })
       .catch(error => {
            console.error("获取豆瓣热门电视剧标签失败：", error);
        });
}

// 渲染热门推荐内容
// 递增的请求序号：快速切换标签时，只渲染最后一次请求的结果，避免旧请求后返回覆盖新标签的内容
let doubanRequestSeq = 0;

function renderRecommend(tag, pageLimit, pageStart) {
    const container = document.getElementById("douban-results");
    if (!container) return;
    const requestSeq = ++doubanRequestSeq;

    const loadingOverlayHTML = `
        <div class="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div class="flex items-center justify-center">
                <div class="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin inline-block"></div>
                <span class="text-pink-500 ml-4">加载中...</span>
            </div>
        </div>
    `;

    container.classList.add("relative");
    container.insertAdjacentHTML('beforeend', loadingOverlayHTML);

    if (doubanMovieTvCurrentSwitch === 'short') {
        renderShortDrama(tag, Math.floor(pageStart / pageLimit) + 1, container, requestSeq);
        return;
    }
    
    const target = `https://movie.douban.com/j/search_subjects?type=${encodeURIComponent(doubanMovieTvCurrentSwitch)}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;
    
    // 使用通用请求函数
    fetchDoubanData(target)
        .then(data => {
            if (requestSeq !== doubanRequestSeq) return;
            renderDoubanCards(data, container);
        })
        .catch(error => {
            if (requestSeq !== doubanRequestSeq) return;
            console.error("获取豆瓣数据失败：", error);
            container.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <div class="text-red-400">❌ 获取豆瓣数据失败</div>
                    <button type="button" class="douban-retry mt-3" data-action="retryDoubanRecommend">重试</button>
                </div>
            `;
        });
}

// 豆瓣接口偶尔超时或返回错误，经代理最多请求 3 次（间隔递增）
const DOUBAN_RETRY_DELAYS = [0, 800, 2000];
const DOUBAN_TIMEOUT = 8000;

async function fetchDoubanViaProxy(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOUBAN_TIMEOUT);
    try {
        const response = await fetch(PROXY_URL + encodeURIComponent(url), {
            signal: controller.signal,
            headers: { 'Accept': 'application/json, text/plain, */*' }
        });
        if (!response.ok) {
            const error = new Error(`HTTP error! Status: ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

// 加载失败后的「重试」按钮
function retryDoubanRecommend() {
    renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
}

async function fetchDoubanData(url) {
    let lastError;
    for (const [attempt, delay] of DOUBAN_RETRY_DELAYS.entries()) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        try {
            return await fetchDoubanViaProxy(url);
        } catch (err) {
            lastError = err;
            console.warn(`豆瓣 API 请求失败（第 ${attempt + 1} 次）：`, err);
            // 未登录、被拒绝或请求过于频繁时重试没有意义
            if ([401, 403, 429].includes(err.status)) break;
        }
    }
    throw lastError;
}

// 海报异步加载：先显示占位，加载完成后淡入；失败时（网页端）间隔重试，App 内由 native-app.js 改用原生请求
const COVER_RETRY_DELAYS = [1000, 3000];

document.addEventListener('load', event => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.classList.contains('douban-cover')) {
        img.classList.add('is-loaded');
        img.parentElement.classList.remove('is-failed');
    }
}, true);

document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('douban-cover')) return;
    if (document.documentElement.classList.contains('native-app')) return;
    const attempt = Number(img.dataset.retry || 0);
    if (attempt >= COVER_RETRY_DELAYS.length) {
        img.parentElement.classList.add('is-failed');
        return;
    }
    img.dataset.retry = String(attempt + 1);
    const src = img.getAttribute('src');
    setTimeout(() => {
        if (img.isConnected) img.setAttribute('src', src);
    }, COVER_RETRY_DELAYS[attempt]);
}, true);

// 抽取渲染豆瓣卡片的逻辑到单独函数
function renderDoubanCards(data, container) {
    // 创建文档片段以提高性能
    const fragment = document.createDocumentFragment();
    
    // 如果没有数据
    if (!data.subjects || data.subjects.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "col-span-full text-center py-8";
        emptyEl.innerHTML = `
            <div class="text-pink-500">❌ 暂无数据，请尝试其他分类或刷新</div>
        `;
        fragment.appendChild(emptyEl);
    } else {
        // 循环创建每个影视卡片
        data.subjects.forEach(item => {
            const card = document.createElement("div");
            card.className = "douban-card bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg";
            
            // 生成卡片内容，确保安全显示（防止XSS）
            const safeTitle = escapeHtml(item.title);
            const safeRate = escapeHtml(item.rate || "暂无");
            const doubanUrl = safeHttpUrl(item.url);
            
            // 豆瓣图床校验 Referer，浏览器直连必然返回 418，因此直接走代理（代理会带上豆瓣 Referer）
            const proxiedCoverUrl = PROXY_URL + encodeURIComponent(safeHttpUrl(item.cover));
            
            // 为不同设备优化卡片布局
            card.innerHTML = `
                <div class="douban-cover-wrap relative w-full aspect-[2/3] overflow-hidden cursor-pointer" ${actionAttrs('fillAndSearchWithDouban', item.title)}>
                    <img src="${escapeHtml(proxiedCoverUrl)}" alt="${safeTitle}"
                        class="douban-cover w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        loading="lazy" decoding="async">
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                    <div class="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                        <span class="text-yellow-400">★</span> ${safeRate}
                    </div>
                    <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm hover:bg-[#333] transition-colors">
                        <a href="${escapeHtml(doubanUrl)}" target="_blank" rel="noopener noreferrer" title="在豆瓣查看">
                            🔗
                        </a>
                    </div>
                </div>
                <div class="p-2 text-center bg-[#111]">
                    <button ${actionAttrs('fillAndSearchWithDouban', item.title)} 
                            class="text-sm font-medium text-white truncate w-full hover:text-pink-400 transition"
                            title="${safeTitle}">
                        ${safeTitle}
                    </button>
                </div>
            `;
            
            fragment.appendChild(card);
        });
    }
    
    // 清空并添加所有新元素
    container.innerHTML = "";
    container.appendChild(fragment);
}

// 重置到首页
function resetToHome() {
    resetSearchArea();
    updateDoubanVisibility();
}

// 加载豆瓣首页内容
document.addEventListener('DOMContentLoaded', initDouban);
