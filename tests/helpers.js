// 端到端测试的公共工具：登录、模拟数据源与豆瓣接口（测试不依赖外部网站）。

export const PASSWORD = 'test-pass';
export const ADMIN_PASSWORD = 'admin-pass';

/** 通过接口登录，Cookie 写入当前浏览器上下文 */
export async function login(page) {
    const response = await page.request.post('/auth/login', { data: { password: PASSWORD } });
    if (!response.ok()) throw new Error(`登录失败：${response.status()}`);
}

/** 跳过使用声明，并设置初始偏好 */
export async function prepare(page, { douban = false, apis = ['bfzy', 'ruyi'] } = {}) {
    await page.addInitScript(({ douban, apis }) => {
        localStorage.setItem('hasSeenDisclaimer', 'true');
        localStorage.setItem('doubanEnabled', String(douban));
        localStorage.setItem('selectedAPIs', JSON.stringify(apis));
        localStorage.setItem('hasInitializedDefaults', 'true');
    }, { douban, apis });
}

export function vod(id, name, extra = {}) {
    return {
        vod_id: id,
        vod_name: name,
        vod_pic: 'http://localhost:8099/image/icon-512.png',
        type_name: '国产剧',
        vod_year: '2026',
        vod_area: '中国大陆',
        vod_director: '导演',
        vod_actor: '演员甲,演员乙',
        vod_remarks: '更新至第3集',
        vod_content: '简介&nbsp;内容',
        vod_play_url: [1, 2, 3].map(n => `第${n}集$https://media.example/${id}/${n}.m3u8`).join('#'),
        ...extra
    };
}

/**
 * 模拟经 /proxy/ 访问的数据源与豆瓣接口。
 * search(sourceHost) 返回该数据源的搜索结果；detail(id) 返回详情；未匹配的请求一律 404。
 */
export async function mockSources(page, { search = () => [], detail = id => vod(id, '剧集' + id), douban = [] } = {}) {
    await page.route('**/proxy/**', route => {
        const target = decodeURIComponent(route.request().url().split('/proxy/')[1] || '');
        const url = new URL(target);
        if (url.hostname === 'movie.douban.com') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ subjects: douban }) });
        }
        if (url.searchParams.get('ac') === 'videolist' && url.searchParams.has('ids')) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ list: [detail(url.searchParams.get('ids'))] }) });
        }
        if (url.searchParams.get('ac') === 'videolist') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ list: search(url.hostname), pagecount: 1 }) });
        }
        return route.fulfill({ status: 404, body: 'not mocked' });
    });
}
