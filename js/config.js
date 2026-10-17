// 全局常量配置
const PROXY_URL = '/proxy/';    // 由服务端（lib/handler.mjs）提供；App 内由 js/native-app.js 改为原生请求

// 服务端写入页面的登录状态（<script type="application/json" id="auth-state">，见 lib/auth.mjs）；
// 没有服务端时（App 或纯静态预览）保留占位符，解析失败即为 null，视为无需密码
window.__AUTH__ = (() => {
    try {
        return JSON.parse(document.getElementById('auth-state').textContent);
    } catch {
        return null;
    }
})();
const SEARCH_HISTORY_KEY = 'videoSearchHistory';
const MAX_HISTORY_ITEMS = 5;

// API站点配置
const API_SITES = {
    dyttzy: {
        api: 'https://caiji.dyttzyapi.com/api.php/provide/vod',
        name: '电影天堂资源',
        detail: 'https://caiji.dyttzyapi.com', 
    },
    ruyi: {
        api: 'https://cj.rycjapi.com/api.php/provide/vod',
        name: '如意资源',
    },
    bfzy: {
        api: 'https://bfzyapi.com/api.php/provide/vod',
        name: '暴风资源',
    },
    ffzy: {
        api: 'https://ffzy5.tv/api.php/provide/vod',
        name: '非凡影视',
        detail: 'https://ffzy5.tv', 
    },
    zy360: {
        api: 'https://360zy.com/api.php/provide/vod',
        name: '360资源',
    },
    iqiyi: {
        api: 'https://www.iqiyizyapi.com/api.php/provide/vod',
        name: 'iqiyi资源',
    }, 
    jisu: {
        api: 'https://jszyapi.com/api.php/provide/vod',
        name: '极速资源',
        detail: 'https://jszyapi.com', 
    },
    mdzy: {
        api: 'https://www.mdzyapi.com/api.php/provide/vod',
        name: '魔都资源',
    },
    zuid: {
        api: 'https://api.zuidapi.com/api.php/provide/vod',
        name: '最大资源'
    },
    baidu: {
        api: 'https://api.apibdzy.com/api.php/provide/vod',
        name: '百度云资源'
    },
    ikun: {
        api: 'https://ikunzyapi.com/api.php/provide/vod',
        name: 'iKun资源'
    },
};

// 短剧（首页「短剧」频道，见 js/short-drama.js）：取自下列资源站的短剧分类。各站分类编号不同且会变化，运行时从 ?ac=list 识别：
// 名称含「短剧」的分类为「最新」，其下的子分类按题材关键词归入各标签（名称含「擦边」的分类一律排除）。
const SHORT_DRAMA_SOURCES = ['ruyi', 'dyttzy', 'bfzy', 'jisu', 'zy360'];
const SHORT_DRAMA_GENRES = [
    { name: '古装仙侠', keywords: ['古装', '仙侠'] },
    { name: '现代都市', keywords: ['都市'] },
    { name: '穿越年代', keywords: ['穿越', '年代'] },
    { name: '重生民国', keywords: ['重生', '民国'] },
    { name: '言情总裁', keywords: ['言情', '总裁', '恋爱', '女频'] },
    { name: '反转爽剧', keywords: ['反转', '爽'] },
    { name: '脑洞悬疑', keywords: ['脑洞', '悬疑'] },
    { name: 'AI短剧', keywords: ['ai'] }
];

// 抽象API请求配置
const API_CONFIG = {
    search: {
        // 只拼接参数部分，不再包含 /api.php/provide/vod/
        path: '?ac=videolist&wd=',
        pagePath: '?ac=videolist&wd={query}&pg={page}',
        maxPages: 5, // 每个数据源最多获取的页数（每页约 20 条；过多会同时发出大量请求，变慢且容易被限流）
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    },
    detail: {
        // 只拼接参数部分
        path: '?ac=videolist&ids=',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    }
};

// 优化后的正则表达式模式
const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

// 增加视频播放相关配置
const PLAYER_CONFIG = {
    adFilteringStorage: 'adFilteringEnabled' // 存储广告过滤设置的键名
};

