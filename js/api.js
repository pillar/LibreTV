// 视频详情：从数据源获取剧集播放地址与简介。搜索见 js/search.js。

const DETAIL_TIMEOUT = 10000;

/** 自定义数据源（设置面板中添加，存于 localStorage）；首页与播放页都会用到 */
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    const list = JSON.parse(localStorage.getItem('customAPIs') || '[]');
    if (isNaN(index) || index < 0 || index >= list.length) {
        return null;
    }
    return list[index];
}

/** 数据源配置：内置源（API_SITES 的键）或自定义源（custom_序号） */
function resolveDetailSource(sourceCode) {
    if (sourceCode.startsWith('custom_')) {
        const customApi = getCustomApiInfo(sourceCode.slice('custom_'.length));
        if (!customApi) throw new Error('自定义API配置无效');
        return { name: customApi.name || '自定义源', api: customApi.url, detailPage: customApi.detail || '' };
    }
    const site = API_SITES[sourceCode];
    if (!site) throw new Error('无效的API来源');
    return { name: site.name, api: site.api, detailPage: site.detail || '' };
}

/** 从详情页 HTML 中提取 m3u8 地址（部分数据源的接口不返回播放地址） */
function extractM3u8Links(html, sourceCode) {
    let matches = [];
    if (sourceCode === 'ffzy') {
        // 非凡影视的播放地址格式固定，先用精确的规则，避免匹配到其他线路
        matches = html.match(/\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g) || [];
    }
    if (matches.length === 0) {
        matches = html.match(/\$(https?:\/\/[^"'\s]+?\.m3u8)/g) || [];
    }
    return [...new Set(matches)].map(link => {
        link = link.slice(1);
        const parenIndex = link.indexOf('(');
        return parenIndex > 0 ? link.slice(0, parenIndex) : link;
    });
}

async function fetchDetailPage(source, id, sourceCode) {
    const detailUrl = `${source.detailPage}/index.php/vod/detail/id/${id}.html`;
    const response = await fetch(PROXY_URL + encodeURIComponent(detailUrl), { signal: AbortSignal.timeout(DETAIL_TIMEOUT) });
    if (!response.ok) throw new Error(`详情页请求失败: ${response.status}`);
    const html = await response.text();

    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/);
    return {
        episodes: extractM3u8Links(html, sourceCode),
        detailUrl,
        videoInfo: {
            title: titleMatch ? titleMatch[1].trim() : '',
            desc: descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : '',
            source_name: source.name,
            source_code: sourceCode
        }
    };
}

/**
 * 从接口的 vod_play_url 中取各集地址。一部剧可能有多个播放源（以 $$$ 分隔），
 * 有的只是网页分享链接，优先选用全部为 m3u8 的播放源，否则用第一个。
 */
function parsePlayUrls(videoDetail) {
    if (videoDetail.vod_play_url) {
        const sources = videoDetail.vod_play_url.split('$$$').map(source => source.split('#')
            .map(ep => {
                const parts = ep.split('$');
                return parts.length > 1 ? parts[1].trim() : '';
            })
            .filter(url => url.startsWith('http://') || url.startsWith('https://')));
        const episodes = sources.find(urls => urls.length && urls.every(url => /\.m3u8(\?|$)/i.test(url)))
            || sources.find(urls => urls.length);
        if (episodes) return episodes;
    }
    // 没有播放地址时，尝试从简介中查找 m3u8 链接
    const matches = (videoDetail.vod_content || '').match(M3U8_PATTERN) || [];
    return matches.map(link => link.replace(/^\$/, ''));
}

/**
 * 获取视频详情
 * @param {string} id 视频 ID
 * @param {string} sourceCode 内置源的键或 custom_序号
 * @returns {Promise<{episodes: string[], detailUrl: string, videoInfo: object}>} 失败时抛出错误
 */
async function fetchVideoDetail(id, sourceCode) {
    if (!id || !/^[\w-]+$/.test(String(id))) throw new Error('无效的视频ID格式');
    const source = resolveDetailSource(sourceCode || '');

    // 配置了详情页地址的数据源，先从详情页提取播放地址；详情页取不到（如被站点防火墙拦截）时改用接口
    if (source.detailPage) {
        try {
            const fromPage = await fetchDetailPage(source, id, sourceCode);
            if (fromPage.episodes.length) return fromPage;
        } catch (error) {
            console.warn(`${source.name} 详情页获取失败，改用接口:`, error);
        }
    }

    const detailUrl = `${source.api}${API_CONFIG.detail.path}${id}`;
    const response = await fetch(PROXY_URL + encodeURIComponent(detailUrl), {
        headers: API_CONFIG.detail.headers,
        signal: AbortSignal.timeout(DETAIL_TIMEOUT)
    });
    if (!response.ok) throw new Error(`详情请求失败: ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.list) || data.list.length === 0) throw new Error('获取到的详情内容无效');

    const videoDetail = data.list[0];
    return {
        episodes: parsePlayUrls(videoDetail),
        detailUrl,
        videoInfo: {
            title: videoDetail.vod_name,
            cover: videoDetail.vod_pic,
            desc: videoDetail.vod_content,
            type: videoDetail.type_name,
            year: videoDetail.vod_year,
            area: videoDetail.vod_area,
            director: videoDetail.vod_director,
            actor: videoDetail.vod_actor,
            remarks: videoDetail.vod_remarks,
            source_name: source.name,
            source_code: sourceCode
        }
    };
}
