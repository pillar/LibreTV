// 密码保护：密码只在服务端校验（见 lib/auth.mjs），页面通过服务端写入的 window.__AUTH__ 得知登录状态。
// window.__AUTH__ 为 null 表示没有服务端（如 App 或纯静态预览），视为无需密码。

function authState() {
    return window.__AUTH__ || { passwordRequired: false, authenticated: true, adminRequired: false, admin: true };
}

/** 是否设置了访问密码 */
function isPasswordProtected() {
    return Boolean(authState().passwordRequired);
}

/** 当前是否已通过访问密码验证（未设置密码时始终为 true） */
function isPasswordVerified() {
    const state = authState();
    return !state.passwordRequired || Boolean(state.authenticated);
}

/** 是否设置了管理员密码（用于设置面板） */
function isAdminProtected() {
    return Boolean(authState().adminRequired);
}

/** 当前是否已通过管理员密码验证 */
function isAdminVerified() {
    const state = authState();
    return !state.adminRequired || Boolean(state.admin);
}

/**
 * 向服务端提交密码，成功后服务端设置登录 Cookie
 * @param {string} password
 * @param {'PASSWORD'|'ADMINPASSWORD'} passwordType
 * @returns {Promise<'ok'|'wrong'|'limited'|'error'>}
 */
async function verifyPassword(password, passwordType = 'PASSWORD') {
    const type = passwordType === 'ADMINPASSWORD' ? 'admin' : 'user';
    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password, type })
        });
        if (response.status === 429) return 'limited';
        if (!response.ok) return 'wrong';
        window.__AUTH__ = { ...authState(), [type === 'admin' ? 'admin' : 'authenticated']: true };
        return 'ok';
    } catch (error) {
        console.error('密码验证请求失败:', error);
        return 'error';
    }
}

const PASSWORD_ERRORS = {
    wrong: '密码错误，请重试',
    limited: '尝试次数过多，请一分钟后再试',
    error: '网络错误，请稍后重试'
};

window.isPasswordProtected = isPasswordProtected;
window.isPasswordVerified = isPasswordVerified;
window.isAdminProtected = isAdminProtected;
window.isAdminVerified = isAdminVerified;
window.verifyPassword = verifyPassword;

// 登录过期时（代理返回 401）重新要求输入密码
(function () {
    const originalFetch = window.fetch;
    window.fetch = async function (input) {
        const response = await originalFetch.apply(this, arguments);
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (response.status === 401 && url.includes('/proxy/') && window.__AUTH__) {
            window.__AUTH__.authenticated = false;
            showPasswordModal();
        }
        return response;
    };
})();

// SHA-256 十六进制摘要（导入/导出配置的校验值使用）。优先使用 Web Crypto；
// 通过 HTTP 访问时浏览器不提供 crypto.subtle，改用 libs/sha256.min.js 提供的 window.sha256
async function sha256Hex(message) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof window.sha256 === 'function') {
        return window.sha256(message);
    }
    throw new Error('No SHA-256 implementation available.');
}

/**
 * 显示访问密码弹窗
 */
function showPasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (!passwordModal) return;
    // 防止出现豆瓣区域滚动条
    const doubanArea = document.getElementById('doubanArea');
    if (doubanArea) doubanArea.classList.add('hidden');

    const title = passwordModal.querySelector('h2');
    if (title) title.textContent = '访问验证';
    const form = document.getElementById('passwordForm');
    if (form) {
        form.onsubmit = event => {
            event.preventDefault();
            handlePasswordSubmit();
        };
    }

    passwordModal.style.display = 'flex';
    setTimeout(() => {
        const passwordInput = document.getElementById('passwordInput');
        if (passwordInput) passwordInput.focus();
    }, 100);
}

/**
 * 隐藏密码弹窗
 */
function hidePasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        passwordModal.style.display = 'none';

        // 恢复豆瓣区域的显示（豆瓣已在页面加载时初始化，这里只在列表为空时加载内容）
        if (typeof updateDoubanVisibility === 'function') {
            updateDoubanVisibility();
        }
    }
}

function showPasswordError(result = 'wrong') {
    const errorElement = document.getElementById('passwordError');
    if (!errorElement) return;
    errorElement.textContent = PASSWORD_ERRORS[result] || PASSWORD_ERRORS.wrong;
    errorElement.classList.remove('hidden');
}

function hidePasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) errorElement.classList.add('hidden');
}

/**
 * 处理访问密码提交
 */
async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('passwordInput');
    const password = passwordInput ? passwordInput.value.trim() : '';
    const submitButton = document.getElementById('passwordSubmitBtn');
    if (submitButton) submitButton.disabled = true;
    const result = await verifyPassword(password);
    if (submitButton) submitButton.disabled = false;
    if (result === 'ok') {
        hidePasswordError();
        hidePasswordModal();
        document.dispatchEvent(new CustomEvent('passwordVerified'));
    } else {
        showPasswordError(result);
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
    }
}

/**
 * 设置按钮的管理员密码验证
 */
function showAdminPasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (!passwordModal) return;

    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) passwordInput.value = '';
    const title = passwordModal.querySelector('h2');
    if (title) title.textContent = '管理员验证';
    passwordModal.style.display = 'flex';

    const form = document.getElementById('passwordForm');
    if (form) {
        form.onsubmit = async function (event) {
            event.preventDefault();
            const password = document.getElementById('passwordInput').value.trim();
            const result = await verifyPassword(password, 'ADMINPASSWORD');
            if (result === 'ok') {
                hidePasswordError();
                passwordModal.style.display = 'none';
                document.getElementById('settingsPanel').classList.add('show');
            } else {
                showPasswordError(result);
            }
        };
    }
}

// 页面加载后，未登录时显示密码框
document.addEventListener('DOMContentLoaded', function () {
    if (!isPasswordVerified()) showPasswordModal();
});
