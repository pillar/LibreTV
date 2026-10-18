// 外观对比：npm run visual [-- <git 版本，默认 HEAD>]
// 在临时 git worktree 中构建指定版本并截图作为基准，再构建当前工作区代码逐像素比较（界面状态见 tests/visual/visual.spec.js）。
// 两次截图在同一台机器、同一个浏览器上完成，不受系统字体差异影响；基准截图不提交到仓库。
// 不一致时差异图（预期 / 实际 / 差异）在 visual-results/diff/ 中。
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASSWORD, ADMIN_PASSWORD } from '../tests/helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || 'HEAD';
const out = join(root, 'visual-results');
const config = join(root, 'tests/visual/playwright.config.js');
const base = join(mkdtempSync(join(tmpdir(), 'playany-visual-')), 'base');

const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
const PORT = '8199';

/** 用 cwd 中的 server.mjs 与 dist/ 提供页面，运行截图测试，返回是否全部通过 */
async function playwright(cwd, extraArgs = [], { quiet = false } = {}) {
    const server = spawn('node', ['server.mjs'], {
        cwd, stdio: 'ignore',
        env: { ...process.env, PORT, PASSWORD, ADMINPASSWORD: ADMIN_PASSWORD, LOGIN_RATE_LIMIT: '1000' }
    });
    try {
        await waitForServer();
        run(join(root, 'node_modules/.bin/playwright'), ['test', '-c', config, ...extraArgs], {
            stdio: quiet ? 'ignore' : 'inherit',
            env: { ...process.env, VISUAL_PORT: PORT, VISUAL_OUT: out }
        });
        return true;
    } catch {
        return false;
    } finally {
        server.kill();
    }
}

async function waitForServer() {
    for (let i = 0; i < 50; i++) {
        try {
            await fetch(`http://localhost:${PORT}/`);
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    throw new Error(`server.mjs 没有在端口 ${PORT} 启动`);
}
// 基准截图：第一次运行时写出全部截图（没有基准，测试会失败，忽略），再截一次与之一致才采用，
// 因为 Chrome 偶尔会把个别文字渲染错几个像素。没有用 --update-snapshots：它在测试结束后经常卡住不退出。
// 核对基准与对比时，不一致的界面重试两次。
const BASELINE_ATTEMPTS = 3;

rmSync(out, { recursive: true, force: true });
run('git', ['worktree', 'add', '--detach', base, ref]);
let failed = false;
try {
    symlinkSync(join(root, 'node_modules'), join(base, 'node_modules'));
    run('node', ['scripts/build.mjs'], { cwd: base });
    let stable = false;
    for (let attempt = 1; attempt <= BASELINE_ATTEMPTS && !stable; attempt++) {
        console.log(`\n基准截图：${ref}（第 ${attempt} 次）`);
        rmSync(out, { recursive: true, force: true });
        await playwright(base, [], { quiet: true });
        stable = await playwright(base, ['--retries=2']);
    }
    if (!stable) throw new Error(`${ref} 连续 ${BASELINE_ATTEMPTS} 次截图不一致，无法作为基准`);

    run('node', ['scripts/build.mjs']);
    console.log('\n对比截图：当前工作区');
    failed = !await playwright(root, ['--retries=2']);
} finally {
    run('git', ['worktree', 'remove', '--force', base]);
}

if (failed) {
    console.error(`\n外观与 ${ref} 不一致，差异图见 ${join(out, 'diff')}`);
    process.exit(1);
}
rmSync(out, { recursive: true, force: true });
console.log(`\n外观与 ${ref} 一致`);
