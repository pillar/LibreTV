# PlayAny TV iOS / Android 客户端

基于 [Capacitor 8](https://capacitorjs.com/) 把仓库根目录的前端页面打包成原生 App。App 内置全部静态页面，不依赖自建服务器。

## 与网页版的差异

| 能力 | 网页版 | App |
| --- | --- | --- |
| 数据源 / 豆瓣请求 | 经服务端 `/proxy/` 转发 | `js/native-app.js` 把 `/proxy/` 请求改走原生 HTTP（CapacitorHttp），不受 CORS 限制 |
| 豆瓣海报回退 | 经 `/proxy/` | 原生请求并带豆瓣 Referer，转成 data URL |
| 视频播放 | 浏览器直连 m3u8 | WebView 直连 m3u8，同样依赖视频 CDN 的 CORS 设置 |
| 密码保护 | 服务端注入 `PASSWORD` | **不支持**（没有服务端注入，`{{PASSWORD}}` 占位符不会被替换，相当于未设置密码） |
| 离线缓存 | 不支持 | 播放页「缓存」→ 本集 / 全部剧集；首页导航栏「我的下载」管理。分片与密钥下载到 App 的 Library 目录，断网可播；前台下载，切到后台暂停、回到前台继续（`js/downloads.js`） |
| 全屏 | 浏览器全屏 | 网页内全屏 + 横屏 + 隐藏状态栏/Home 条；播放器锁定时 iOS 推迟系统边缘手势，Android 屏蔽返回键 |
| HTTP 明文源 | 取决于部署站点 | 已允许（iOS `NSAllowsArbitraryLoads`，Android `cleartext` + `allowMixedContent`），因为不少数据源和 m3u8 只有 http |

## 环境要求

- Node.js 20+
- iOS：macOS + Xcode 16+（Swift Package Manager，无需 CocoaPods）
- Android：JDK 21 + Android SDK（compileSdk 36），或直接用 Android Studio

## 构建

```bash
cd mobile
npm install
npm run sync          # 复制根目录前端文件到 www/ 并同步到 ios/、android/
```

修改了根目录的 HTML / CSS / JS 之后，都要重新执行 `npm run sync`。

### iOS

```bash
npm run open:ios      # 用 Xcode 打开，选择设备后运行
# 或命令行编译模拟器版本：
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
```

真机安装和上架需要在 Xcode 的 Signing & Capabilities 中配置自己的开发者团队。

### Android

```bash
cd android
./gradlew assembleDebug                 # 产物：app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease               # 发布版需先在 app/build.gradle 配置签名
```

## 自定义

- 包名 / App 名称：`capacitor.config.json` 中的 `appId`、`appName`（当前为 `app.playany.tv`），修改后需要同步修改 `android/app/build.gradle` 的 `applicationId` 和 Xcode 里的 Bundle Identifier。
- 图标和启动图：替换 `assets/logo.png`（1024×1024），然后执行
  `npx @capacitor/assets generate --iconBackgroundColor '#000000' --splashBackgroundColor '#07070c'`。

## 已知限制

- 应用商店审核：苹果和谷歌对“聚合第三方视频源”的应用审核较严格，本工程主要用于自行安装（侧载 / TestFlight / 企业分发）。
- 原生请求无法中途取消：搜索超时后，调用方会立即收到 `AbortError`，但底层请求会在后台自然结束。
