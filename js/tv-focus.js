// Apple TV 式聚焦效果：指针在卡片上移动时，按位置写入倾斜角度（--rx / --ry）和高光位置（--mx / --my），
// 由 css/theme.css 渲染成 tvOS 的视差倾斜与高光。只在有悬停能力的设备上启用。
(function () {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const SELECTOR = '.card-hover, .douban-card';
    const MAX_TILT = 6; // 最大倾斜角度（度）
    let latest = null;
    let scheduled = false;
    let current = null;

    function reset(card) {
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
    }

    // 每帧最多处理一次最新的指针位置
    document.addEventListener('pointermove', event => {
        latest = event;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const card = latest.target instanceof Element ? latest.target.closest(SELECTOR) : null;
            if (current && current !== card) reset(current);
            current = card;
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const x = (latest.clientX - rect.left) / rect.width;
            const y = (latest.clientY - rect.top) / rect.height;
            card.style.setProperty('--mx', `${x * 100}%`);
            card.style.setProperty('--my', `${y * 100}%`);
            card.style.setProperty('--rx', `${(0.5 - y) * MAX_TILT}deg`);
            card.style.setProperty('--ry', `${(x - 0.5) * MAX_TILT}deg`);
        });
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
        if (current) reset(current);
        current = null;
    });
})();
