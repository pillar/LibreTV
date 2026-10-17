// 网站曾注册过一个不缓存任何内容的 Service Worker（service-worker.js，已删除），这里为之前访问过的浏览器注销它。
// 删除条件：大部分老用户都已重新打开过网站之后（例如 2027 年中）可以删除本文件。
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
        .then(registrations => registrations.forEach(registration => registration.unregister()))
        .catch(() => {});
}
