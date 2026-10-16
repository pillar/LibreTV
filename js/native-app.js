// iOS / Android 客户端（Capacitor）适配，网页端不生效。
// App 内没有服务端 /proxy/，这里把发往 PROXY_URL 的请求改用原生 HTTP 直连目标地址，原生请求不受 CORS 限制。
(function () {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

    document.documentElement.classList.add('native-app');

    const plugins = cap.Plugins || {};
    if (plugins.SystemBars) {
        // 浅色背景配深色状态栏文字
        plugins.SystemBars.setStyle({ style: 'LIGHT' }).catch(() => {});
    }

    // ---- 播放器沉浸式全屏与锁定（由 player.js 调用） ----
    // App 内不用 WebView 的元素全屏，而是网页内全屏 + 横屏 + 隐藏系统栏；
    // 锁定时通知原生（iOS）推迟系统边缘手势，防止误触退出。
    window.NativeApp = {
        async setImmersive(on) {
            const bars = plugins.SystemBars;
            const orientation = plugins.ScreenOrientation;
            // 不指定具体的栏时，SystemBars 会同时隐藏/显示状态栏和 Home 条（Android 为导航栏）。
            // iOS 上状态栏的显示/隐藏动画会打断正在进行的旋转，所以先切换系统栏、等动画结束再旋转。
            const lockTo = async type => {
                try {
                    await orientation.lock({ orientation: type });
                } catch {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await orientation.lock({ orientation: type }).catch(() => {});
                }
            };
            try {
                if (on) {
                    if (bars) await bars.hide();
                    await new Promise(resolve => setTimeout(resolve, 350));
                    if (orientation) await lockTo('landscape');
                } else {
                    if (bars) await bars.show();
                    await new Promise(resolve => setTimeout(resolve, 350));
                    // 先转回竖屏再解除锁定，否则横持手机时会停留在横屏
                    if (orientation) {
                        await lockTo('portrait');
                        // lock() 发出旋转请求后立即返回，等旋转完成再解锁，否则会被解锁打断
                        await new Promise(resolve => setTimeout(resolve, 800));
                        await orientation.unlock();
                    }
                }
            } catch (error) {
                console.error('切换沉浸式全屏失败:', error && error.message);
            }
        },
        setLocked(on) {
            if (plugins.ScreenLock) plugins.ScreenLock.setLocked({ locked: on }).catch(() => {});
        }
    };

    // Android 返回键：先派发 nativeback 事件交给页面处理（播放器锁定时忽略、全屏时退出全屏），
    // 页面未处理时再后退或退出 App
    if (plugins.App) {
        plugins.App.addListener('backButton', ({ canGoBack }) => {
            const event = new CustomEvent('nativeback', { cancelable: true });
            window.dispatchEvent(event);
            if (event.defaultPrevented) return;
            if (canGoBack) window.history.back();
            else plugins.App.exitApp();
        });
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
        // 偶发失败时间隔重试，共 3 次
        const delays = [0, 1000, 3000];
        const attempt = async index => {
            if (delays[index]) await new Promise(resolve => setTimeout(resolve, delays[index]));
            const res = await nativeHttp.request({ url: target, headers, responseType: 'blob' });
            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
            return res;
        };
        const load = index => attempt(index).catch(error => {
            if (index + 1 < delays.length && img.isConnected) return load(index + 1);
            throw error;
        });
        load(0).then(res => {
            const type = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || 'image/jpeg';
            img.classList.remove('object-contain');
            img.src = `data:${type};base64,${res.data}`;
        }).catch(error => {
            console.error('原生加载图片失败:', target, error && error.message);
            if (img.parentElement) img.parentElement.classList.add('is-failed');
        });
    }, true);

    // ---- 网络不可用提示 ----
    // 国行 iPhone 首次打开 App 时需要授权「无线数据」，未授权时所有请求都会失败。
    // 请求失败后再探测一次 Apple 的联网检测地址：探测也失败才认为 App 没有网络，避免把单个数据源宕机误报成断网。
    const CONNECTIVITY_URL = 'https://captive.apple.com/hotspot-detect.html';
    const isIOS = cap.getPlatform() === 'ios';
    let probing = null;
    let networkHint = null;

    function checkConnectivity() {
        if (!probing) {
            probing = nativeHttp.request({ url: CONNECTIVITY_URL, responseType: 'text', connectTimeout: 5000, readTimeout: 5000 })
                .then(() => true, () => false)
                .finally(() => setTimeout(() => { probing = null; }, 3000));
        }
        return probing;
    }

    function showNetworkHint() {
        if (networkHint || !document.body) return;
        networkHint = document.createElement('div');
        networkHint.className = 'network-hint';
        networkHint.setAttribute('role', 'alert');
        networkHint.innerHTML = `
            <div class="network-hint-text">
                <strong>无法连接网络</strong>
                <span>${isIOS
                    ? '请在「设置 → PlayAny TV → 无线数据」中选择「WLAN 与蜂窝网络」，然后返回 App。'
                    : '请检查网络连接后重试。'}</span>
            </div>
            ${isIOS ? '<button type="button" class="network-hint-action" data-action="settings">去设置</button>' : ''}
            <button type="button" class="network-hint-close" data-action="close" aria-label="关闭">✕</button>`;
        networkHint.addEventListener('click', event => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            // iOS 上跳转 app-settings: 会由系统打开本 App 的设置页
            if (action === 'settings') window.location.href = 'app-settings:';
            if (action === 'close') hideNetworkHint();
        });
        document.body.appendChild(networkHint);
    }

    function hideNetworkHint() {
        if (!networkHint) return;
        networkHint.remove();
        networkHint = null;
    }

    // 用户去设置里改完权限再回到 App 时，重新加载页面
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && networkHint) window.location.reload();
    });

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
            hideNetworkHint();
            const noBody = [204, 205, 304].includes(res.status);
            const body = noBody ? null : typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            const contentType = res.headers && (res.headers['Content-Type'] || res.headers['content-type']);
            return new Response(body, {
                status: res.status,
                headers: contentType ? { 'Content-Type': contentType } : {}
            });
        }, error => {
            checkConnectivity().then(online => { if (!online) showNetworkHint(); });
            throw error;
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
