# PlayAny TV - 免费在线视频搜索与观看平台

<div align="center">
  <img src="image/logo.png" alt="PlayAny TV" width="120">
  <br>
  <p><strong>想看就看，随处可播</strong></p>
</div>

## 📺 项目简介

PlayAny TV 是一个轻量级的在线视频搜索与观看平台，聚合多个视频源的搜索结果并直接播放。无需注册，即开即用，网页、iOS、Android 均可使用。网页版由前端页面和一个服务端代理组成，可部署在支持服务端函数的托管平台上。

## ⚠️ 安全与隐私提醒

**强烈建议设置密码保护**（环境变量 `PASSWORD`）：

- 不设置密码的实例任何人都可以访问，可能被恶意利用；
- 公开的视频搜索服务可能面临版权方的投诉；
- 设置密码可以限制访问范围，保护你的使用记录。

请仅供个人使用，不要公开分享实例链接，并遵守当地法律法规。

## 📋 部署

### Cloudflare Workers

1. 把本仓库推送到你自己的 GitHub 账户；
2. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 的 Workers 中导入该仓库（Workers Builds），构建命令留空，部署命令为 `npx wrangler deploy`（部署前会自动执行 `npm run build`）；
3. 修改 `wrangler.jsonc` 中的 Worker 名称与自定义域名；
4. 在 Worker 的「设置 > 变量和机密」中以 Secret 添加 `PASSWORD`（可选 `ADMINPASSWORD`、`SESSION_SECRET`）。**务必设置 `PASSWORD`**：不设置时任何人都能使用 `/proxy/`，网站会成为公开代理；
5. 推送到 main 分支即自动部署。

入口是 `worker.js`，处理逻辑在 `lib/handler.mjs`（与 Docker 版共用）。登录与代理按客户端 IP 限流（Durable Object 计数，见 `worker.js`），数据源接口结果在服务端缓存 5 分钟。

### Docker

```bash
docker build -t playany-tv .
docker run -d --name playany-tv --restart unless-stopped \
  -p 8899:8080 \
  -e PASSWORD=your_password \
  playany-tv
```

或使用仓库中的 `docker-compose.yml`：

```bash
docker compose up -d
```

访问 `http://localhost:8899` 即可使用。其他配置（管理员密码、限流、反向代理）见 `.env.example`。

### 本地开发

```bash
cp .env.example .env   # 可选
npm install
npm run dev            # 构建 dist/ 并启动 Node 版服务，修改服务端代码后自动重启
```

访问 `http://localhost:8080`（端口可通过 `.env` 中的 `PORT` 修改）。修改前端文件后重新运行 `npm run build`。也可以用 `npx wrangler dev` 在本地运行 Worker 版。

网站文件构建到 `dist/`（`scripts/build.mjs`）：Worker、Docker 和 App 都只发布这个目录。每个页面的脚本和样式各合并压缩成一个带内容哈希的文件（`dist/assets/`），浏览器可长期缓存；Tailwind 样式在构建时生成。页面不允许内联脚本和内联事件（CSP），交互请用 `data-action`（见 `js/actions.js`）。前端脚本是普通脚本，文件之间通过全局函数互相调用，`npm run lint`（ESLint）会检查调用了不存在的函数和未使用的变量。颜色用 `tailwind.config.js` 中与 `css/theme.css` 变量对应的语义色（`bg-surface`、`bg-fill`、`text-ink-2` 等），不要再写深色的 `bg-[#111]` 之类。

代码检查与端到端测试（先运行 ESLint 并构建，再同时启动 Node 版与本地 Worker，数据源接口使用模拟数据）：

```bash
npx playwright install chromium webkit   # 首次运行前安装浏览器（本地默认使用已安装的 Chrome；WebKit 用于 iPhone 专有的播放页测试）
npm test
```

推送到 GitHub 后，`.github/workflows/test.yml` 会自动运行代码检查与全部测试。

修改样式后用外观对比确认没有意外变化：`npm run visual`（与上次提交比较）或 `npm run visual -- <git 版本>`。它在临时 worktree 中构建指定版本截图作为基准，再截取当前代码的同一批界面（桌面与手机各 21 个，见 `tests/visual/visual.spec.js`）逐像素比较，不一致时差异图在 `visual-results/diff/`。不在 `npm test` 和 CI 中运行。

## 📱 iOS / Android 客户端

`mobile/` 目录是基于 Capacitor 的原生 App 工程（包名 `app.playany.tv`），内置全部前端页面，数据源请求走原生 HTTP，不需要自建服务器。构建方法和限制见 [mobile/README.md](mobile/README.md)。

## 🔧 自定义配置

### 密码保护

| 环境变量 | 说明 |
| --- | --- |
| `PASSWORD` | 访问密码 |
| `ADMINPASSWORD` | 设置面板密码（可选） |
| `SESSION_SECRET` | 登录 Cookie 的签名密钥（可选，不设置时由密码派生） |

各平台在项目的环境变量设置中添加即可；Docker 通过 `-e` 传入，本地开发写在 `.env` 中。

密码只在服务端校验，通过后下发有效期 90 天的 HttpOnly Cookie；页面中不含任何密码信息，`/proxy/` 代理也只对已登录用户开放，并且不会访问内网与云元数据地址。修改 `PASSWORD` 后所有设备需要重新登录。

### 自定义数据源

支持标准的苹果 CMS V10 API 格式：

- 搜索接口：`https://example.com/api.php/provide/vod/?ac=videolist&wd=关键词`
- 详情接口：`https://example.com/api.php/provide/vod/?ac=detail&ids=视频ID`

在设置面板的「自定义 API」中填写 `https://example.com/api.php/provide/vod` 即可。

## ⌨️ 播放器快捷键

| 按键 | 功能 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| ← / → | 快退 / 快进 |
| ↑ / ↓ | 音量增减 |
| M | 静音 |
| F | 全屏 |
| Esc | 退出全屏 |

## 🛠️ 技术栈

- HTML + CSS + JavaScript，Tailwind CSS（预编译为 `css/tailwind.css`）
- ArtPlayer + HLS.js 播放
- 服务端：Cloudflare Workers（线上）或 Node.js `server.mjs`（Docker / 本地），共用 `lib/handler.mjs`
- Capacitor 8（iOS / Android 客户端）

## ⚠️ 免责声明

PlayAny TV 仅作为视频搜索工具，不存储、上传或分发任何视频内容，所有视频均来自第三方 API 接口的搜索结果。如有侵权内容，请联系相应的内容提供方，或发送邮件至 support@playany.app。

使用本项目时，你必须遵守当地的法律法规，开发者不对使用本项目产生的任何后果负责。

## 📄 许可与来源

本项目基于开源项目 LibreTV 修改，遵循 [Apache License 2.0](LICENSE)。
