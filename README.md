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

### Cloudflare Pages

1. 把本仓库推送到你自己的 GitHub 账户；
2. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 的 Pages 中创建项目并连接该仓库；
3. 构建命令和输出目录都留空；
4. 在「设置 > 环境变量」中添加 `PASSWORD`（可选 `ADMINPASSWORD`）；
5. 可选：绑定名为 `PLAYANY_PROXY_KV` 的 KV 命名空间，用于缓存代理结果；
6. 保存并部署。

### Vercel / Netlify

导入仓库、使用默认设置，在环境变量中添加 `PASSWORD`（可选 `ADMINPASSWORD`）后部署即可。

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

访问 `http://localhost:8899` 即可使用。

### 本地开发

```bash
cp .env.example .env   # 可选
npm install
npm run dev
```

访问 `http://localhost:8080`（端口可通过 `.env` 中的 `PORT` 修改）。

> 使用 `python -m http.server` 这类纯静态服务器时没有代理功能，搜索无法使用，请使用 Node.js 开发服务器。

样式使用预编译的 Tailwind：修改了页面或脚本中的 Tailwind 类名后，运行 `npm run build:css` 重新生成 `css/tailwind.css` 并一起提交（部署时不会自动构建）。

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
- Node.js / Cloudflare / Vercel / Netlify 服务端代理
- Capacitor 8（iOS / Android 客户端）

## ⚠️ 免责声明

PlayAny TV 仅作为视频搜索工具，不存储、上传或分发任何视频内容，所有视频均来自第三方 API 接口的搜索结果。如有侵权内容，请联系相应的内容提供方，或发送邮件至 support@playany.app。

使用本项目时，你必须遵守当地的法律法规，开发者不对使用本项目产生的任何后果负责。

## 📄 许可与来源

本项目基于开源项目 LibreTV 修改，遵循 [Apache License 2.0](LICENSE)。
