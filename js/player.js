const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '[]');
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 返回地址只接受本站页面，防止 returnUrl=javascript:... 之类的跳转
function sameOriginUrl(value) {
    try {
        const url = new URL(String(value || ''), window.location.href);
        return url.origin === window.location.origin ? url.href : '';
    } catch {
        return '';
    }
}

// 左上角 Logo：回到首页
function goHome(event) {
    if (event) event.preventDefault();
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', () => {
    const homeButton = document.getElementById('homeButton');
    if (homeButton) homeButton.addEventListener('click', goHome);
});

// 返回：回到打开播放页的页面（网址参数 back，只接受本站页面），没有时回首页
function goBack(event) {
    if (event) event.preventDefault();
    window.location.href = sameOriginUrl(new URLSearchParams(window.location.search).get('back')) || '/';
}


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let art = null; // 用于 ArtPlayer 实例
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let currentVideoPoster = ''; // 写入观看历史，供「继续观看」显示
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
// 实际已加载到播放器中的视频地址；切换剧集期间为 null。
// 进度按它保存，避免切换过程中旧视频的事件把进度写到新剧集名下
let progressUrl = null;
// 正在通过 art.switchUrl 切换剧集（ArtPlayer 会在加载后把进度归零，需在切换完成后再恢复续播）
let switchingEpisode = false;
// 重建播放器时暂时退出网页全屏，期间不改变 App 的横屏与系统栏
let keepImmersive = false;
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
Artplayer.FULLSCREEN_WEB_IN_BODY = true;

// 页面加载
document.addEventListener('DOMContentLoaded', function () {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('player-loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('player-loading').style.display = 'block';

    initializePageContent();
});

// 初始化页面内容
function initializePageContent() {

    // 网址参数与打开前保存的剧集列表（见 js/play-context.js）
    const urlParams = new URLSearchParams(window.location.search);
    const sourceCode = urlParams.get('source') || '';
    const vodId = urlParams.get('id') || '';
    const offline = urlParams.get('offline') === '1';
    const context = readPlayContext({ source: sourceCode, id: vodId, series: offline ? urlParams.get('series') : '' });
    currentEpisodes = context ? context.episodes : [];
    currentVideoPoster = (context && context.poster) || '';
    currentVideoTitle = urlParams.get('title') || (context && context.title) || '未知视频';
    let index = parseInt(urlParams.get('index') || '0');
    if (!(index >= 0)) index = 0;
    if (currentEpisodes.length && index >= currentEpisodes.length) index = currentEpisodes.length - 1;
    currentEpisodeIndex = index;
    const videoUrl = urlParams.get('url') || currentEpisodes[index] || '';
    currentVideoUrl = videoUrl;
    episodesReversed = localStorage.getItem('episodesReversed') === 'true';

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true

    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function (e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });

    // 设置页面标题
    document.title = currentVideoTitle + ' - PlayAny TV';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 初始化播放器；没有剧集列表（新标签页打开）或来自观看历史时，按 source + id 获取最新的列表
    if (videoUrl) initPlayer(videoUrl);
    if (!offline && sourceCode && vodId && (!context || context.refresh)) {
        refreshEpisodes(sourceCode, vodId);
    } else if (!videoUrl) {
        showError('无效的视频链接');
    } else if (!currentEpisodes.length) {
        currentEpisodes = [videoUrl];
    }

    // 渲染源信息
    renderResourceInfoBar();

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // 更新排序按钮状态
    updateOrderButton();

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 视频暂停时也保存
    const waitForVideo = setInterval(() => {
        if (art && art.video) {
            art.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            art.video.addEventListener('timeupdate', function() {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);
}

// 获取最新的剧集列表；还没有在播的视频时（网址只有 source + id）从列表中取当前集开始播放
async function refreshEpisodes(sourceCode, vodId) {
    try {
        const data = await fetchVideoDetail(vodId, sourceCode);
        if (!data.episodes.length) throw new Error('没有可播放的剧集');
        currentEpisodes = data.episodes;
        if (!currentVideoPoster) currentVideoPoster = safeHttpUrl(data.videoInfo && data.videoInfo.cover);
        if (currentEpisodeIndex >= currentEpisodes.length) currentEpisodeIndex = currentEpisodes.length - 1;
        if (!currentVideoUrl) {
            currentVideoUrl = currentEpisodes[currentEpisodeIndex];
            initPlayer(currentVideoUrl);
        }
    } catch (error) {
        console.warn('获取剧集列表失败，使用已有的列表:', error);
        if (!currentVideoUrl) {
            showError('获取剧集失败，请返回重试或换一个数据源');
            return;
        }
        if (!currentEpisodes.length) currentEpisodes = [currentVideoUrl];
    }
    renderResourceInfoBar();
    updateEpisodeInfo();
    renderEpisodes();
    updateButtonStates();
}

// 初始化播放器
function initPlayer(videoUrl) {
    if (!videoUrl) {
        return
    }

    // 销毁旧实例。网页全屏时 ArtPlayer 把播放器移到了 body 下（FULLSCREEN_WEB_IN_BODY），destroy 只清理原容器，
    // 旧播放器会留在全屏层盖住新播放器（停在上一集结尾并显示加载失败），所以先退出网页全屏、创建新播放器后再恢复
    let restoreFullscreenWeb = false;
    if (art) {
        restoreFullscreenWeb = art.fullscreenWeb;
        if (restoreFullscreenWeb) {
            keepImmersive = true;
            art.fullscreenWeb = false;
            keepImmersive = false;
        }
        art.destroy();
        art = null;
    }

    // 配置HLS.js选项
    const hlsConfig = {
        debug: false,
        loader: adFilteringEnabled ? CustomHlsJsLoader : Hls.DefaultConfig.loader,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,  // 增加尝试次数
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: 'm3u8',
        title: currentVideoTitle,
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: !window.NativeApp,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        hotkey: false,
        theme: '#23ade5',
        lang: navigator.language.toLowerCase(),
        moreVideoAttr: {
            crossOrigin: 'anonymous',
        },
        customType: {
            m3u8: function (video, url) {
                // 清理之前的HLS实例
                if (currentHls && currentHls.destroy) {
                    try {
                        currentHls.destroy();
                    } catch (e) {
                    }
                }

                // 创建新的HLS实例
                const hls = new Hls(hlsConfig);
                currentHls = hls;

                // 跟踪是否已经显示错误
                let errorDisplayed = false;
                // 跟踪是否有错误发生
                let errorCount = 0;
                // 跟踪视频是否开始播放
                let playbackStarted = false;
                // 跟踪视频是否出现bufferAppendError
                let bufferAppendErrorCount = 0;

                // 监听视频播放事件
                video.addEventListener('playing', function () {
                    playbackStarted = true;
                    document.getElementById('player-loading').style.display = 'none';
                    document.getElementById('error').style.display = 'none';
                });

                // 监听视频进度事件
                video.addEventListener('timeupdate', function () {
                    if (video.currentTime > 1) {
                        // 视频进度超过1秒，隐藏错误（如果存在）
                        document.getElementById('error').style.display = 'none';
                    }
                });

                hls.loadSource(url);
                hls.attachMedia(video);

                // enable airplay, from https://github.com/video-dev/hls.js/issues/5989
                // 检查是否已存在source元素，如果存在则更新，不存在则创建
                let sourceElement = video.querySelector('source');
                if (sourceElement) {
                    // 更新现有source元素的URL
                    sourceElement.src = videoUrl;
                } else {
                    // 创建新的source元素
                    sourceElement = document.createElement('source');
                    sourceElement.src = videoUrl;
                    video.appendChild(sourceElement);
                }
                video.disableRemotePlayback = false;

                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    video.play().catch(e => {
                    });
                });

                hls.on(Hls.Events.ERROR, function (event, data) {
                    // 增加错误计数
                    errorCount++;

                    // 处理bufferAppendError
                    if (data.details === 'bufferAppendError') {
                        bufferAppendErrorCount++;
                        // 如果视频已经开始播放，则忽略这个错误
                        if (playbackStarted) {
                            return;
                        }

                        // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                        if (bufferAppendErrorCount >= 3) {
                            hls.recoverMediaError();
                        }
                    }

                    // 如果是致命错误，且视频未播放
                    if (data.fatal && !playbackStarted) {
                        // 尝试恢复错误
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                hls.recoverMediaError();
                                break;
                            default:
                                // 仅在多次恢复尝试后显示错误
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError('视频加载失败，可能是格式不兼容或源不可用');
                                }
                                break;
                        }
                    }
                });

                // 监听分段加载事件
                hls.on(Hls.Events.FRAG_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });

                // 监听级别加载事件
                hls.on(Hls.Events.LEVEL_LOADED, function () {
                    document.getElementById('player-loading').style.display = 'none';
                });
            }
        }
    });

    // 网页内全屏：App 内同时横屏并隐藏系统栏。
    // ArtPlayer 只发出 fullscreenWeb 事件，参数表示进入（true）或退出（false）；控制栏的自动隐藏由 ArtPlayer 自身处理。
    art.on('fullscreenWeb', state => {
        if (window.NativeApp && !keepImmersive) window.NativeApp.setImmersive(state);
    });
    // 立即恢复（不等视频加载成功），加载失败时错误提示也显示在全屏层中
    if (restoreFullscreenWeb) art.fullscreenWeb = true;

    // 播放器加载完成后初始隐藏工具栏
    art.on('ready', () => {
        art.controls.show = false;
    });

    setupPlayerLock();

    // 全屏模式处理
    art.on('fullscreen', function () {
        if (window.screen.orientation && window.screen.orientation.lock) {
            window.screen.orientation.lock('landscape')
                .then(() => {
                })
                .catch((error) => {
                });
        }
    });

    art.on('video:loadedmetadata', function() {
        document.getElementById('player-loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志
        // 切换剧集时 ArtPlayer 会在 loadedmetadata 之后把进度归零，续播在 playEpisode 中等切换完成后再恢复
        if (!switchingEpisode) {
            restoreSavedProgress();
            progressUrl = currentVideoUrl;
        }

        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);

        // 启动定期保存播放进度
        startProgressSaveInterval();
    })

    // 错误处理
    art.on('video:error', function (error) {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            return;
        }

        // 隐藏所有加载指示器
        const loadingElements = document.querySelectorAll('#player-loading, .player-loading-container');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });

        showError('视频播放失败: ' + (error.message || '未知错误'));
    });

    // 添加移动端长按三倍速播放功能
    setupLongPressSpeedControl();

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集
        if (autoplayEnabled && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 稍长延迟以确保所有事件处理完成
            setTimeout(() => {
                // 确认不是因为用户拖拽导致的假结束事件
                playNextEpisode();
                videoHasEnded = false; // 重置标志
            }, 1000);
        } else {
            exitFullscreen();
        }
    });

    // 添加双击全屏支持
    art.on('video:playing', () => {
        // 绑定双击事件到视频元素（video:playing 每次继续播放都会触发，只绑定一次，避免双击时切换多次）
        if (art.video && !art.video.dataset.dblclickBound) {
            art.video.dataset.dblclickBound = '1';
            art.video.addEventListener('dblclick', () => {
                toggleFullscreen();
                art.play();
            });
        }
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (art && art.video && art.video.currentTime > 0) {
            return;
        }

        const loadingElement = document.getElementById('player-loading');
        if (loadingElement && loadingElement.style.display !== 'none') {
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    // 如果是m3u8文件，处理内容以移除广告分段
                    if (response.data && typeof response.data === 'string') {
                        // 过滤掉广告段 - 实现更精确的广告过滤逻辑
                        response.data = filterAdsFromM3U8(response.data, true);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// 过滤可疑的广告内容
function filterAdsFromM3U8(m3u8Content, strictMode = false) {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 只过滤#EXT-X-DISCONTINUITY标识
        if (!line.includes('#EXT-X-DISCONTINUITY')) {
            filteredLines.push(line);
        }
    }

    return filteredLines.join('\n');
}


// 显示错误
function showError(message) {
    // 在视频已经播放的情况下不显示错误
    if (art && art.video && art.video.currentTime > 1) {
        return;
    }
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'flex';
    const errorMsgEl = document.getElementById('error-message');
    if (errorMsgEl) errorMsgEl.textContent = message;
}

// 更新集数信息
function updateEpisodeInfo() {
    if (currentEpisodes.length > 0) {
        document.getElementById('episodeInfo').textContent = `第 ${currentEpisodeIndex + 1}/${currentEpisodes.length} 集`;
    } else {
        document.getElementById('episodeInfo').textContent = '无集数信息';
    }
}

// 更新按钮状态
function updateButtonStates() {
    const setEnabled = (button, enabled) => {
        button.disabled = !enabled;
        button.classList.toggle('cursor-not-allowed', !enabled);
        button.classList.toggle('hover:bg-fill-hover', enabled);
    };
    setEnabled(document.getElementById('prevButton'), currentEpisodeIndex > 0);
    setEnabled(document.getElementById('nextButton'), currentEpisodeIndex < currentEpisodes.length - 1);
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-ink-2 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;

        html += `
            <button id="episode-${realIndex}" 
                    ${actionAttrs('playEpisode', realIndex)} 
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-fill hover:!bg-fill-hover hover:!shadow-none text-ink'} !border ${isActive ? '!border-transparent' : '!border-transparent'} rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    });

    episodesList.innerHTML = html;
}

// 播放指定集数
function playEpisode(index) {
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // 先保存当前集的进度，切换期间暂停保存（新视频加载完成后在 video:loadedmetadata 中恢复）
    saveCurrentProgress();
    progressUrl = null;

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false; // 重置视频结束标志
    // 不在这里清除进度：此时 currentVideoUrl 已是目标集，清除的会是目标集的续播进度（看完的集在 video:ended 中清除）

    // 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    window.history.replaceState({}, '', currentUrl.toString());

    if (isWebkit) {
        initPlayer(url);
    } else {
        switchingEpisode = true;
        art.switchUrl(url).then(() => {
            restoreSavedProgress();
        }).catch(() => {}).finally(() => {
            switchingEpisode = false;
            progressUrl = currentVideoUrl;
        });
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    userClickedPosition = null;

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;

    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);

    // 重新渲染集数列表
    renderEpisodes();

    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');

    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}
