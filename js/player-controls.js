// 播放器的全屏、锁定、快退/快进按钮、键盘快捷键与长按倍速（播放页，配合 js/player.js）。

// ---- 全屏与锁定 ----
// App 内（存在 window.NativeApp）使用网页内全屏，并由原生负责横屏与隐藏系统栏；浏览器中使用浏览器全屏。
function toggleFullscreen() {
    if (!art) return;
    if (window.NativeApp) art.fullscreenWeb = !art.fullscreenWeb;
    else art.fullscreen = !art.fullscreen;
}

function exitFullscreen() {
    if (!art) return;
    if (art.fullscreenWeb) art.fullscreenWeb = false;
    if (art.fullscreen) art.fullscreen = false;
}

const LOCK_ICONS = {
    locked: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlocked: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/></svg>'
};

const SEEK_ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><text x="12" y="16" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif">5</text></svg>',
    forward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/><text x="12" y="16" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="-apple-system,system-ui,sans-serif">5</text></svg>'
};

// 锁定：隐藏全部控件，并用一层遮挡拦截点击、双击、拖动等操作，只保留锁按钮；
// 锁定期间轻点画面只会短暂显示锁按钮，防止观看时误触暂停、拖动进度或退出全屏。
let controlsLocked = false;
let lockFlashTimer = null;

function setupPlayerLock() {
    const $player = art.template.$player;
    const layer = document.createElement('div');
    layer.className = 'art-lock-layer';
    layer.innerHTML = `<button type="button" class="art-lock-btn"></button>
        <div class="art-seek-btns">
            <button type="button" data-seek="-5" aria-label="后退 5 秒" title="后退 5 秒">${SEEK_ICONS.back}</button>
            <button type="button" data-seek="5" aria-label="快进 5 秒" title="快进 5 秒">${SEEK_ICONS.forward}</button>
        </div>`;
    $player.appendChild(layer);

    // 快退 / 快进 5 秒：和锁按钮一样随控制条显示，锁定时隐藏
    layer.querySelector('.art-seek-btns').addEventListener('click', event => {
        const seekButton = event.target.closest('[data-seek]');
        event.stopPropagation();
        if (!seekButton || controlsLocked || !art) return;
        const offset = Number(seekButton.dataset.seek);
        const duration = art.duration || Infinity;
        art.seek = Math.min(Math.max(0, art.currentTime + offset), duration);
        art.notice.show = offset > 0 ? '快进 5 秒' : '后退 5 秒';
        art.controls.show = true;
    });

    const button = layer.querySelector('.art-lock-btn');
    button.addEventListener('click', event => {
        event.stopPropagation();
        setControlsLocked(!controlsLocked);
    });
    // 锁定时遮挡层接收点击：只闪现锁按钮
    layer.addEventListener('click', event => {
        if (event.target === layer) flashLockButton();
    });
    ['dblclick', 'touchstart', 'touchmove', 'mousedown', 'wheel', 'contextmenu'].forEach(type => {
        layer.addEventListener(type, event => {
            if (event.target === layer) event.stopPropagation();
        }, { passive: true });
    });

    renderLockState();
}

function setControlsLocked(locked) {
    controlsLocked = locked;
    if (art) {
        if (locked) art.controls.show = false;
        art.notice.show = locked ? '屏幕已锁定' : '屏幕已解锁';
    }
    renderLockState();
    flashLockButton();
    if (window.NativeApp) window.NativeApp.setLocked(locked);
}

function renderLockState() {
    const label = controlsLocked ? '解锁屏幕' : '锁定屏幕';
    if (art) {
        art.template.$player.classList.toggle('art-locked', controlsLocked);
        const button = art.template.$player.querySelector('.art-lock-btn');
        if (button) {
            button.innerHTML = controlsLocked ? LOCK_ICONS.locked : LOCK_ICONS.unlocked;
            button.setAttribute('aria-label', label);
            button.title = label;
        }
    }
    // 播放器下方的锁定按钮同步状态
    const pageButton = document.getElementById('lockToggle');
    if (pageButton) {
        pageButton.innerHTML = controlsLocked ? LOCK_ICONS.locked : LOCK_ICONS.unlocked;
        pageButton.title = label;
        pageButton.classList.toggle('is-locked', controlsLocked);
    }
}

function flashLockButton() {
    if (!art) return;
    const $player = art.template.$player;
    $player.classList.add('art-lock-flash');
    clearTimeout(lockFlashTimer);
    lockFlashTimer = setTimeout(() => $player.classList.remove('art-lock-flash'), 2500);
}

function toggleControlsLock() {
    setControlsLocked(!controlsLocked);
}

// App 返回键（Android）：锁定时忽略，全屏时先退出全屏，否则回到上一页
window.addEventListener('nativeback', event => {
    if (controlsLocked) {
        event.preventDefault();
        flashLockButton();
    } else if (art && art.fullscreenWeb) {
        event.preventDefault();
        art.fullscreenWeb = false;
    } else {
        // 与页面上的「上一页」相同：回到来源页面。（Android WebView 在播放页报告无法后退，
        // 交给原生处理会直接退出 App）
        event.preventDefault();
        goBack();
    }
});

// ---- 键盘快捷键 ----

// 处理键盘快捷键
function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // 播放器锁定时不响应快捷键
    if (controlsLocked) return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
        if (currentEpisodeIndex > 0) {
            playPreviousEpisode();
            showShortcutHint('上一集', 'left');
            e.preventDefault();
        }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
        if (currentEpisodeIndex < currentEpisodes.length - 1) {
            playNextEpisode();
            showShortcutHint('下一集', 'right');
            e.preventDefault();
        }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
        if (art && art.currentTime > 5) {
            art.currentTime -= 5;
            showShortcutHint('快退', 'left');
            e.preventDefault();
        }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
        if (art && art.currentTime < art.duration - 5) {
            art.currentTime += 5;
            showShortcutHint('快进', 'right');
            e.preventDefault();
        }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
        if (art && art.volume < 1) {
            art.volume += 0.1;
            showShortcutHint('音量+', 'up');
            e.preventDefault();
        }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
        if (art && art.volume > 0) {
            art.volume -= 0.1;
            showShortcutHint('音量-', 'down');
            e.preventDefault();
        }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
        if (art) {
            art.toggle();
            showShortcutHint('播放/暂停', 'play');
            e.preventDefault();
        }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
        if (art) {
            toggleFullscreen();
            showShortcutHint('切换全屏', 'fullscreen');
            e.preventDefault();
        }
    }
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else if (direction === 'right') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }  else if (direction === 'up') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>';
    } else if (direction === 'down') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>';
    } else if (direction === 'fullscreen') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>';
    } else if (direction === 'play') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// ---- 长按倍速 ----

// 设置移动端长按三倍速播放功能
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    const playerElement = document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(`${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键（避免长按倍速时弹出系统菜单），桌面设备上允许右键菜单
        return !isMobile;
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (art.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 播放器锁定时不触发长按倍速
        if (controlsLocked) return;

        // 保存原始播放速度
        originalPlaybackRate = art.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (art.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速
            art.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
        }
    }, { passive: false });

    // 视频暂停时取消长按状态
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}
