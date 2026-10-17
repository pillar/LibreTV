// 观看历史面板（首页）：打开/关闭、列表、删除、从历史继续播放。播放页写入历史见 js/player-progress.js。

// 历史面板相关函数
function toggleHistory(e) {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }
    if (e) e.stopPropagation();

    const panel = document.getElementById('historyPanel');
    if (panel) {
        panel.classList.toggle('show');

        // 如果打开了历史记录面板，则加载历史数据
        if (panel.classList.contains('show')) {
            loadViewingHistory();
        }

        // 如果设置面板是打开的，则关闭它
        const settingsPanel = document.getElementById('settingsPanel');
        if (settingsPanel && settingsPanel.classList.contains('show')) {
            settingsPanel.classList.remove('show');
        }
    }
}

// 格式化时间戳为友好的日期时间格式
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    // 小于1小时，显示"X分钟前"
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return minutes <= 0 ? '刚刚' : `${minutes}分钟前`;
    }

    // 小于24小时，显示"X小时前"
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}小时前`;
    }

    // 小于7天，显示"X天前"
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}天前`;
    }

    // 其他情况，显示完整日期
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 获取观看历史记录
function getViewingHistory() {
    try {
        const data = localStorage.getItem('viewingHistory');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('获取观看历史失败:', e);
        return [];
    }
}

// 加载观看历史并渲染
function loadViewingHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    const history = getViewingHistory();

    if (history.length === 0) {
        historyList.innerHTML = `<div class="text-center text-gray-500 py-8">暂无观看记录</div>`;
        return;
    }

    // 渲染历史记录
    historyList.innerHTML = history.map(item => {
        // 防止XSS
        const safeTitle = escapeHtml(item.title);
        const safeSource = item.sourceName ? escapeHtml(item.sourceName) : '未知来源';
        // 历史记录可能来自导入的配置，数值字段统一转成数字再拼接
        const episodeIndex = Number(item.episodeIndex) || 0;
        const playbackPosition = Number(item.playbackPosition) || 0;

        const episodeText = item.episodeIndex !== undefined ?
            `第${episodeIndex + 1}集` : '';

        // 格式化剧集信息
        let episodeInfoHtml = '';
        if (item.episodes && Array.isArray(item.episodes) && item.episodes.length > 0) {
            const totalEpisodes = item.episodes.length;
            const syncStatus = item.lastSyncTime ?
                `<span class="text-green-400 text-xs" title="剧集列表已同步">✓</span>` :
                `<span class="text-yellow-400 text-xs" title="使用缓存数据">⚠</span>`;
            episodeInfoHtml = `<span class="text-xs text-gray-400">共${totalEpisodes}集 ${syncStatus}</span>`;
        }

        // 格式化进度信息
        let progressHtml = '';
        if (item.playbackPosition && item.duration && item.playbackPosition > 10 && item.playbackPosition < item.duration * 0.95) {
            const percent = Math.round((item.playbackPosition / item.duration) * 100);
            const formattedTime = formatPlaybackTime(item.playbackPosition);
            const formattedDuration = formatPlaybackTime(item.duration);

            progressHtml = `
                <div class="history-progress">
                    <div class="progress-bar">
                        <div class="progress-filled" style="width:${percent}%"></div>
                    </div>
                    <div class="progress-text">${formattedTime} / ${formattedDuration}</div>
                </div>
            `;
        }

        // 构建历史记录项HTML，添加删除按钮，需要放在position:relative的容器中
        return `
            <div class="history-item cursor-pointer relative group" ${actionAttrs('playFromHistory', item.url, item.title, episodeIndex, playbackPosition)}>
                <button ${actionAttrs('deleteHistoryItem', encodeURIComponent(item.url))}
                        class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-400 hover:text-red-400 p-1 rounded-full hover:bg-gray-800 z-10"
                        title="删除记录">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
                <div class="history-info">
                    <div class="history-title">${safeTitle}</div>
                    <div class="history-meta">
                        <span class="history-episode">${episodeText}</span>
                        ${episodeText ? '<span class="history-separator mx-1">·</span>' : ''}
                        <span class="history-source">${safeSource}</span>
                        ${episodeInfoHtml ? '<span class="history-separator mx-1">·</span>' : ''}
                        ${episodeInfoHtml}
                    </div>
                    ${progressHtml}
                    <div class="history-time">${formatTimestamp(item.timestamp)}</div>
                </div>
            </div>
        `;
    }).join('');

    // 检查是否存在较多历史记录，添加底部边距确保底部按钮不会挡住内容
    if (history.length > 5) {
        historyList.classList.add('pb-4');
    }
}

// 格式化播放时间为 mm:ss 格式
function formatPlaybackTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 删除单个历史记录项
function deleteHistoryItem(encodedUrl) {
    try {
        // 解码URL
        const url = decodeURIComponent(encodedUrl);

        // 获取当前历史记录
        const history = getViewingHistory();

        // 过滤掉要删除的项
        const newHistory = history.filter(item => item.url !== url);

        // 保存回localStorage
        localStorage.setItem('viewingHistory', JSON.stringify(newHistory));
        window.dispatchEvent(new Event('viewinghistorychange'));

        // 重新加载历史记录显示
        loadViewingHistory();

        // 显示成功提示
        showToast('已删除该记录', 'success');
    } catch (e) {
        console.error('删除历史记录项失败:', e);
        showToast('删除记录失败', 'error');
    }
}

// 从历史记录播放
async function playFromHistory(url, title, episodeIndex, playbackPosition = 0) {
    // console.log('[playFromHistory in ui.js] Called with:', { url, title, episodeIndex, playbackPosition }); // Log 1
    try {
        let episodesList = [];
        let historyItem = null; // To store the full history item
        let syncSuccessful = false;

        // 检查viewingHistory，查找匹配的项
        const historyRaw = localStorage.getItem('viewingHistory');
        if (historyRaw) {
            const history = JSON.parse(historyRaw);
            historyItem = history.find(item => item.url === url);
            // console.log('[playFromHistory in ui.js] Found historyItem:', historyItem ? JSON.parse(JSON.stringify(historyItem)) : null); // Log 2 (stringify/parse for deep copy)
            if (historyItem) {
                // console.log('[playFromHistory in ui.js] historyItem.vod_id:', historyItem.vod_id, 'historyItem.sourceName:', historyItem.sourceName); // Log 3
            }

            if (historyItem && historyItem.episodes && Array.isArray(historyItem.episodes)) {
                episodesList = historyItem.episodes; // Default to stored episodes
                // console.log(`从历史记录找到视频 "${title}" 的集数数据 (默认):`, episodesList.length);
            }
        }

        // Always attempt to fetch fresh episode list if we have the necessary info
        if (historyItem && historyItem.vod_id && historyItem.sourceName) {
            // Show loading toast to indicate syncing
            showToast('正在同步最新剧集列表...', 'info');

            // console.log(`[playFromHistory in ui.js] Attempting to fetch details for vod_id: ${historyItem.vod_id}, sourceName: ${historyItem.sourceName}`); // Log 4
            try {
                // 历史记录中的 sourceCode 为数据源的键（旧记录只有 sourceName）
                const videoDetails = await fetchVideoDetail(historyItem.vod_id, historyItem.sourceCode || historyItem.sourceName);

                if (videoDetails && videoDetails.episodes && videoDetails.episodes.length > 0) {
                    const oldEpisodeCount = episodesList.length;
                    episodesList = videoDetails.episodes;
                    syncSuccessful = true;

                    // Show success message with episode count info
                    const newEpisodeCount = episodesList.length;
                    if (newEpisodeCount > oldEpisodeCount) {
                        showToast(`已同步最新剧集列表 (${newEpisodeCount}集，新增${newEpisodeCount - oldEpisodeCount}集)`, 'success');
                    } else if (newEpisodeCount === oldEpisodeCount) {
                        showToast(`剧集列表已是最新 (${newEpisodeCount}集)`, 'success');
                    } else {
                        showToast(`已同步最新剧集列表 (${newEpisodeCount}集)`, 'success');
                    }

                    // console.log(`成功获取 "${title}" 最新剧集列表:`, episodesList.length, "集");
                    // Update the history item in localStorage with the fresh episodes
                    if (historyItem) {
                        historyItem.episodes = [...episodesList]; // Deep copy
                        historyItem.lastSyncTime = Date.now(); // Add sync timestamp
                        const history = JSON.parse(historyRaw); // Re-parse to ensure we have the latest version
                        const idx = history.findIndex(item => item.url === url);
                        if (idx !== -1) {
                            history[idx] = { ...history[idx], ...historyItem }; // Merge, ensuring other properties are kept
                            localStorage.setItem('viewingHistory', JSON.stringify(history));
                            window.dispatchEvent(new Event('viewinghistorychange'));
                            // console.log("观看历史中的剧集列表已更新。");
                        }
                    }
                } else {
                    // console.log(`未能获取 "${title}" 的最新剧集列表，或列表为空。将使用已存储的剧集。`);
                    showToast('未获取到最新剧集信息，使用缓存数据', 'warning');
                }
            } catch (fetchError) {
                // console.error(`获取 "${title}" 最新剧集列表失败:`, fetchError, "将使用已存储的剧集。");
                if (fetchError.name === 'AbortError') {
                    showToast('同步剧集列表超时，使用缓存数据', 'warning');
                } else {
                    showToast('同步剧集列表失败，使用缓存数据', 'warning');
                }
            }
        } else if (historyItem) {
            // console.log(`历史记录项 "${title}" 缺少 vod_id 或 sourceName，无法刷新剧集列表。将使用已存储的剧集。`);
            showToast('无法同步剧集列表，使用缓存数据', 'info');
        }


        // 如果在历史记录中没找到，尝试使用上一个会话的集数数据
        if (episodesList.length === 0) {
            try {
                const storedEpisodes = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');
                if (storedEpisodes.length > 0) {
                    episodesList = storedEpisodes;
                    // console.log(`使用localStorage中的集数数据:`, episodesList.length);
                }
            } catch (e) {
                // console.error('解析currentEpisodes失败:', e);
            }
        }

        // 将剧集列表保存到localStorage，播放器页面会读取它
        if (episodesList.length > 0) {
            localStorage.setItem('currentEpisodes', JSON.stringify(episodesList));
            // console.log(`已将剧集列表保存到localStorage，共 ${episodesList.length} 集`);
        }
        // 恢复这部剧自己的海报，避免沿用上一部剧的海报
        localStorage.setItem('currentVideoPoster', (historyItem && historyItem.poster) || '');

        // 保存当前页面URL作为返回地址
        let currentPath;
        if (window.location.pathname.startsWith('/player.html') || window.location.pathname.startsWith('/watch.html')) {
            currentPath = localStorage.getItem('lastPageUrl') || '/';
        } else {
            currentPath = window.location.origin + window.location.pathname + window.location.search;
        }
        localStorage.setItem('lastPageUrl', currentPath);

        // 构造播放器URL
        let playerUrl;
        const sourceNameForUrl = historyItem ? historyItem.sourceName : (new URLSearchParams(new URL(url, window.location.origin).search)).get('source');
        const sourceCodeForUrl = historyItem ? historyItem.sourceCode || historyItem.sourceName : (new URLSearchParams(new URL(url, window.location.origin).search)).get('source_code');
        const idForUrl = historyItem ? historyItem.vod_id : '';


        if (url.includes('player.html') || url.includes('watch.html')) {
            // console.log('检测到嵌套播放链接，解析真实URL');
            try {
                const nestedUrl = new URL(url, window.location.origin);
                const nestedParams = nestedUrl.searchParams;
                const realVideoUrl = nestedParams.get('url') || url;

                playerUrl = `player.html?url=${encodeURIComponent(realVideoUrl)}&title=${encodeURIComponent(title)}&index=${episodeIndex}&position=${Math.floor(playbackPosition || 0)}&returnUrl=${encodeURIComponent(currentPath)}`;
                if (sourceNameForUrl) playerUrl += `&source=${encodeURIComponent(sourceNameForUrl)}`;
                if (sourceCodeForUrl) playerUrl += `&source_code=${encodeURIComponent(sourceCodeForUrl)}`;
                if (idForUrl) playerUrl += `&id=${encodeURIComponent(idForUrl)}`;


            } catch (e) {
                // console.error('解析嵌套URL出错:', e);
                playerUrl = `player.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&index=${episodeIndex}&position=${Math.floor(playbackPosition || 0)}&returnUrl=${encodeURIComponent(currentPath)}`;
                if (sourceNameForUrl) playerUrl += `&source=${encodeURIComponent(sourceNameForUrl)}`;
                if (sourceCodeForUrl) playerUrl += `&source_code=${encodeURIComponent(sourceCodeForUrl)}`;
                if (idForUrl) playerUrl += `&id=${encodeURIComponent(idForUrl)}`;
            }
        } else {
             // This case should ideally not happen if 'url' is always a player.html link from history
            // console.warn("Playing from history with a non-player.html URL structure. This might be an issue.");
            const playUrl = new URL(url, window.location.origin);
            if (!playUrl.searchParams.has('index') && episodeIndex > 0) {
                playUrl.searchParams.set('index', episodeIndex);
            }
            playUrl.searchParams.set('position', Math.floor(playbackPosition || 0).toString());
            playUrl.searchParams.set('returnUrl', encodeURIComponent(currentPath));
            if (sourceNameForUrl) playUrl.searchParams.set('source', sourceNameForUrl);
            if (sourceCodeForUrl) playUrl.searchParams.set('source_code', sourceCodeForUrl);
            if (idForUrl) playUrl.searchParams.set('id', idForUrl);
            playerUrl = playUrl.toString();
        }

        showVideoPlayer(playerUrl);
    } catch (e) {
        // console.error('从历史记录播放失败:', e);
        const simpleUrl = `player.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&index=${episodeIndex}`;
        showVideoPlayer(simpleUrl);
    }
}

// 清空观看历史
function clearViewingHistory() {
    try {
        localStorage.removeItem('viewingHistory');
        window.dispatchEvent(new Event('viewinghistorychange'));
        loadViewingHistory(); // 重新加载空的历史记录
        showToast('观看历史已清空', 'success');
    } catch (e) {
        // console.error('清除观看历史失败:', e);
        showToast('清除观看历史失败', 'error');
    }
}

// 更新toggleSettings函数以处理历史面板互动
const originalToggleSettings = toggleSettings;
toggleSettings = function(e) {
    if (e) e.stopPropagation();

    // 原始设置面板切换逻辑
    originalToggleSettings(e);

    // 如果历史记录面板是打开的，则关闭它
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel && historyPanel.classList.contains('show')) {
        historyPanel.classList.remove('show');
    }
};
