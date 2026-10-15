// iOS / Android 客户端（Capacitor）适配，网页端不生效。
// App 内没有服务端 /proxy/，这里把发往 PROXY_URL 的请求改用原生 HTTP 直连目标地址，原生请求不受 CORS 限制。
(function () {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

    document.documentElement.classList.add('native-app');

    const plugins = cap.Plugins || {};
    if (plugins.SystemBars) {
        // 深色背景配浅色状态栏文字
        plugins.SystemBars.setStyle({ style: 'DARK' }).catch(() => {});
    }

    const nativeHttp = plugins.CapacitorHttp;
    if (!nativeHttp) {
        console.error('CapacitorHttp 不可用，App 内无法请求数据源');
        return;
    }

    // 图片回退到 /proxy/ 时（如豆瓣海报）改用原生请求取回，豆瓣图床要求带 Referer
    document.addEventListener('error', event => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || img.dataset.nativeFallback) return;
        const src = img.getAttribute('src') || '';
        if (!src.startsWith(PROXY_URL)) return;
        img.dataset.nativeFallback = '1';
        const target = decodeURIComponent(src.slice(PROXY_URL.length));
        const headers = /\.doubanio\.com\//.test(target) ? { Referer: 'https://movie.douban.com/' } : {};
        nativeHttp.request({ url: target, headers, responseType: 'blob' }).then(res => {
            if (res.status !== 200) return;
            const type = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || 'image/jpeg';
            img.classList.remove('object-contain');
            img.src = `data:${type};base64,${res.data}`;
        }).catch(error => console.error('原生加载图片失败:', target, error && error.message));
    }, true);

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        if (typeof input !== 'string' || !input.startsWith(PROXY_URL)) {
            return originalFetch.apply(this, arguments);
        }
        const options = init || {};
        const signal = options.signal;
        if (signal && signal.aborted) {
            return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        }

        const request = nativeHttp.request({
            url: decodeURIComponent(input.slice(PROXY_URL.length)),
            method: options.method || 'GET',
            headers: Object.fromEntries(new Headers(options.headers || {})),
            responseType: 'text',
            connectTimeout: 15000,
            readTimeout: 20000
        }).then(res => {
            const noBody = [204, 205, 304].includes(res.status);
            const body = noBody ? null : typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            const contentType = res.headers && (res.headers['Content-Type'] || res.headers['content-type']);
            return new Response(body, {
                status: res.status,
                headers: contentType ? { 'Content-Type': contentType } : {}
            });
        });

        if (!signal) return request;
        // 原生请求无法中途取消，这里只让调用方按 AbortSignal 及时得到 AbortError
        return Promise.race([
            request,
            new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    reject(signal.reason || new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            })
        ]);
    };
})();
