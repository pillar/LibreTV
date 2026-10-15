// Liquid Glass 高光：把指针在玻璃元素上的位置写入 --mx / --my，供 css/theme.css 绘制跟随指针的光斑。
// 只在有悬停能力的设备上启用，触屏设备不需要。
(function () {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const SELECTOR = '.glass, .card-hover, .douban-card, .search-shell, .orb-btn';
    let latest = null;
    let scheduled = false;

    // 每帧最多处理一次最新的指针位置
    document.addEventListener('pointermove', event => {
        latest = event;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const target = latest.target instanceof Element ? latest.target.closest(SELECTOR) : null;
            if (target) {
                const rect = target.getBoundingClientRect();
                target.style.setProperty('--mx', `${latest.clientX - rect.left}px`);
                target.style.setProperty('--my', `${latest.clientY - rect.top}px`);
            }
        });
    }, { passive: true });
})();
