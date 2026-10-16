// 播放器的全屏、锁定与快退/快进按钮（播放页，配合 js/player.js）。

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

// App 返回键（Android）：锁定时忽略，全屏时先退出全屏
window.addEventListener('nativeback', event => {
    if (controlsLocked) {
        event.preventDefault();
        flashLockButton();
    } else if (art && art.fullscreenWeb) {
        event.preventDefault();
        art.fullscreenWeb = false;
    }
});
