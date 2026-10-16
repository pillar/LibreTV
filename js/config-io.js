// 设置面板中的导入/导出配置（首页）。

// 导出配置文件的标识；旧名称用于兼容改名前导出的配置
const CONFIG_FILE_NAMES = ['PlayAnyTV-Settings', 'LibreTV-Settings'];

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            if (!CONFIG_FILE_NAMES.includes(config.name)) throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256Hex(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置（只接受白名单内且格式正确的设置项）
            applyImportedConfig(config.data);

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            // 解析并验证配置
            const config = JSON.parse(content);
            if (!CONFIG_FILE_NAMES.includes(config.name)) throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256Hex(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置（只接受白名单内且格式正确的设置项）
            applyImportedConfig(config.data);

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 可导入/导出的设置项
const CONFIG_SETTING_KEYS = [
    'selectedAPIs',
    'customAPIs',
    'yellowFilterEnabled',
    'adFilteringEnabled',
    'doubanEnabled',
    'hasInitializedDefaults'
];
const CONFIG_BOOLEAN_KEYS = ['yellowFilterEnabled', 'adFilteringEnabled', 'doubanEnabled', 'hasInitializedDefaults'];

function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function parseJsonArray(value) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw '配置项格式不正确';
    return parsed;
}

/**
 * 导入配置：只写入白名单内的设置项并校验格式，其余键一律忽略，
 * 防止导入的配置文件写入任意 localStorage 数据（例如伪造的状态或可执行内容）。
 */
function applyImportedConfig(data) {
    if (!data || typeof data !== 'object') throw '配置文件格式不正确';
    const accepted = {};
    const take = (key, normalize) => {
        if (!(key in data)) return;
        if (typeof data[key] !== 'string') throw `配置项 ${key} 格式不正确`;
        accepted[key] = normalize(data[key]);
    };

    CONFIG_BOOLEAN_KEYS.forEach(key => take(key, value => {
        if (value !== 'true' && value !== 'false') throw `配置项 ${key} 格式不正确`;
        return value;
    }));
    take('selectedAPIs', value => JSON.stringify(parseJsonArray(value).filter(v => typeof v === 'string')));
    take('customAPIs', value => JSON.stringify(parseJsonArray(value)
        .filter(api => api && typeof api.name === 'string' && isHttpUrl(api.url))
        .map(api => ({
            name: api.name.slice(0, 50),
            url: api.url,
            detail: typeof api.detail === 'string' && isHttpUrl(api.detail) ? api.detail : '',
            isAdult: api.isAdult === true
        }))));
    take('viewingHistory', value => JSON.stringify(parseJsonArray(value)
        .filter(item => item && typeof item === 'object' && typeof item.title === 'string' && typeof item.url === 'string')));
    take(SEARCH_HISTORY_KEY, value => JSON.stringify(parseJsonArray(value)
        .filter(item => typeof item === 'string' || (item && typeof item.text === 'string'))));

    Object.entries(accepted).forEach(([key, value]) => localStorage.setItem(key, value));
}

// 配置文件导出功能
async function exportConfig() {
    // 存储配置数据
    const config = {};
    const items = {};

    // 导出设置项
    CONFIG_SETTING_KEYS.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            items[key] = value;
        }
    });

    // 导出历史记录
    const viewingHistory = localStorage.getItem('viewingHistory');
    if (viewingHistory) {
        items['viewingHistory'] = viewingHistory;
    }

    const searchHistory = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (searchHistory) {
        items[SEARCH_HISTORY_KEY] = searchHistory;
    }

    const times = Date.now().toString();
    config['name'] = CONFIG_FILE_NAMES[0];  // 配置文件名，用于校验
    config['time'] = times;               // 配置文件生成时间
    config['cfgVer'] = '1.0.0';           // 配置文件版本
    config['data'] = items;               // 配置文件数据
    config['hash'] = await sha256Hex(JSON.stringify(config['data']));  // 计算数据的哈希值，用于校验

    // 将配置数据保存为 JSON 文件
    saveStringAsFile(JSON.stringify(config), 'PlayAnyTV-Settings_' + times + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}
