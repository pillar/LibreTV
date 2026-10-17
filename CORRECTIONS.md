# Corrections

- [2026-10-15] [服务端/代理缓存] 代理响应带 `Cache-Control: public`，被 Cloudflare 边缘缓存后直接返回给未登录用户，绕过了登录校验 → 代理响应只能用 `private` 或 `no-store`；服务端缓存只能放在登录校验之后读取（见 `lib/handler.mjs` 的 cachedProxyFetch、`tests/proxy.spec.js`）。
- [2026-10-15] [前端/去除内联脚本] 改写 `player.html` 的内联脚本时，把 `#homeButton` 的点击处理一起删掉了，Logo 点击无反应 → 删除或迁移内联脚本、内联事件前，逐个列出它绑定的元素与行为并逐一迁移；用 E2E 覆盖（`tests/features.spec.js`「点击左上角 Logo 返回首页」）。
- [2026-10-16] [Cloudflare/限流] Workers Rate Limiting 绑定在 `wrangler dev` 中能触发，但线上连续 350 次请求一次都没有触发 → 已改用 Durable Object 计数（`worker.js` 的 RateLimiter）；限流类功能要在线上实测（例如对被拦截的内网地址连续请求代理，观察是否出现 429），不能只依赖本地模拟。[2026-10-17] 同类问题再次出现：代理限流改成实例内攒 10 次再汇总后，本地（单实例）测试通过，线上请求分散在多个实例上，超限后仍大多放行 → 已改为每个请求都在后台计数（`worker.js` backgroundLimiter）；涉及实例内状态的改动，线上实测要看超限后的整段结果，不只看第一次 429。
- [2026-10-16] [测试/命令] 用 `npm test 2>&1 | grep ... | head` 判断测试结果再 `&& git commit`，退出码来自 `head`，测试失败时仍然提交并推送了 → 需要据测试结果决定后续操作时，使用 `set -o pipefail` 或检查 `npm test` 本身的退出码。
- [2026-10-16] [测试/wrangler dev] `wrangler dev` 默认把 Durable Object 状态保存在 `.wrangler/state`，上一次运行的限流计数会让下一次测试登录失败 → `playwright.config.js` 为每次运行指定新的 `--persist-to` 目录，Worker 测试放宽登录限流，限流本身由 `tests/rate-limit.spec.js` 验证。
- [2026-10-16] [测试/构建产物] 测试服务器提供的是 `dist/`，修改前端后直接运行 `npx playwright test` 测到的是旧代码 → 修改源文件后运行 `npm test`（会先 `npm run build`），或先手动 `npm run build`。
