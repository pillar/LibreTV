// 数据源可用性：资源站经常失效或按地区屏蔽，在本机记录每个源（按接口地址）最近的搜索结果。
// 连续 SOURCE_FAIL_LIMIT 次请求失败（超时、出错、返回的不是结果列表）后暂时跳过 SOURCE_SKIP_MS，之后再尝试一次；
// 搜到 0 条结果不算失败。本站代理自身的拒绝（未登录、限流）也不算数据源失败。
const SOURCE_HEALTH_KEY = 'sourceHealth';
const SOURCE_FAIL_LIMIT = 3;
const SOURCE_SKIP_MS = 6 * 60 * 60 * 1000;

function readSourceHealth() {
    try {
        return JSON.parse(localStorage.getItem(SOURCE_HEALTH_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function recordSourceResult(apiBaseUrl, ok) {
    const health = readSourceHealth();
    if (ok) {
        delete health[apiBaseUrl];
    } else {
        const fails = ((health[apiBaseUrl] && health[apiBaseUrl].fails) || 0) + 1;
        health[apiBaseUrl] = { fails, skipUntil: fails >= SOURCE_FAIL_LIMIT ? Date.now() + SOURCE_SKIP_MS : 0 };
    }
    try {
        localStorage.setItem(SOURCE_HEALTH_KEY, JSON.stringify(health));
    } catch {
        // 存储不可用时只是不记录
    }
}

function sourceApiUrl(apiId) {
    if (apiId.startsWith('custom_')) {
        const customApi = getCustomApiInfo(apiId.slice('custom_'.length));
        return customApi ? customApi.url : '';
    }
    return API_SITES[apiId] ? API_SITES[apiId].api : '';
}

/** 该源最近连续失败、目前处于暂停期 */
function isSourceUnavailable(apiId) {
    const entry = readSourceHealth()[sourceApiUrl(apiId)];
    return Boolean(entry && entry.skipUntil > Date.now());
}

async function searchByAPIAndKeyWord(apiId, query) {
    try {
        let apiUrl, apiName, apiBaseUrl;
        
        // 处理自定义API
        if (apiId.startsWith('custom_')) {
            const customIndex = apiId.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) return [];
            
            apiBaseUrl = customApi.url;
            apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
            apiName = customApi.name;
        } else {
            // 内置API
            if (!API_SITES[apiId]) return [];
            apiBaseUrl = API_SITES[apiId].api;
            apiUrl = apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
            apiName = API_SITES[apiId].name;
        }
        
        // 添加超时处理
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        let response;
        try {
            response = await fetch(PROXY_URL + encodeURIComponent(apiUrl), {
                headers: API_CONFIG.search.headers,
                signal: controller.signal
            });
        } catch (error) {
            // 超时或连接失败
            recordSourceResult(apiBaseUrl, false);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
        
        if (!response.ok) {
            if (response.status !== 401 && response.status !== 429) recordSourceResult(apiBaseUrl, false);
            return [];
        }
        
        let data;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        // 返回的不是结果列表（如数据源关闭了搜索、域名被转到其他网页）
        const valid = Boolean(data && Array.isArray(data.list));
        recordSourceResult(apiBaseUrl, valid);
        if (!valid || data.list.length === 0) {
            return [];
        }
        
        // 处理第一页结果
        const results = data.list.map(item => ({
            ...item,
            source_name: apiName,
            source_code: apiId,
            api_url: apiId.startsWith('custom_') ? getCustomApiInfo(apiId.replace('custom_', ''))?.url : undefined
        }));
        
        // 获取总页数
        const pageCount = data.pagecount || 1;
        // 确定需要获取的额外页数 (最多获取maxPages页)
        const pagesToFetch = Math.min(pageCount - 1, API_CONFIG.search.maxPages - 1);
        
        // 如果有额外页数，获取更多页的结果
        if (pagesToFetch > 0) {
            const additionalPagePromises = [];
            
            for (let page = 2; page <= pagesToFetch + 1; page++) {
                // 构建分页URL
                const pageUrl = apiBaseUrl + API_CONFIG.search.pagePath
                    .replace('{query}', encodeURIComponent(query))
                    .replace('{page}', page);
                
                // 创建获取额外页的Promise
                const pagePromise = (async () => {
                    try {
                        const pageController = new AbortController();
                        const pageTimeoutId = setTimeout(() => pageController.abort(), 8000);
                        
                        const pageResponse = await fetch(PROXY_URL + encodeURIComponent(pageUrl), {
                            headers: API_CONFIG.search.headers,
                            signal: pageController.signal
                        });
                        
                        clearTimeout(pageTimeoutId);
                        
                        if (!pageResponse.ok) return [];
                        
                        const pageData = await pageResponse.json();
                        
                        if (!pageData || !pageData.list || !Array.isArray(pageData.list)) return [];
                        
                        // 处理当前页结果
                        return pageData.list.map(item => ({
                            ...item,
                            source_name: apiName,
                            source_code: apiId,
                            api_url: apiId.startsWith('custom_') ? getCustomApiInfo(apiId.replace('custom_', ''))?.url : undefined
                        }));
                    } catch (error) {
                        console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                        return [];
                    }
                })();
                
                additionalPagePromises.push(pagePromise);
            }
            
            // 等待所有额外页的结果
            const additionalResults = await Promise.all(additionalPagePromises);
            
            // 合并所有页的结果
            additionalResults.forEach(pageResults => {
                if (pageResults.length > 0) {
                    results.push(...pageResults);
                }
            });
        }
        
        return results;
    } catch (error) {
        console.warn(`API ${apiId} 搜索失败:`, error);
        return [];
    }
}