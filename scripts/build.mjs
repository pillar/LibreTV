// 构建网站到 dist/：Cloudflare Worker（wrangler.jsonc 的 assets）、Node server.mjs 和 App（mobile/scripts/copy-web.mjs）都只发布这个目录。
// 只复制下列网站文件，服务端代码、依赖、测试与 App 工程不会出现在 dist/ 中。
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 端到端测试先统一构建一次，再启动 Node 版与 wrangler dev；wrangler dev 会自动执行构建命令，这里跳过以免并发清空 dist/
if (process.env.PLAYANY_SKIP_BUILD === '1') {
    console.log('已跳过构建（PLAYANY_SKIP_BUILD=1）');
    process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');

const ENTRIES = [
    'index.html', 'player.html', 'watch.html', 'about.html', 'privacy.html',
    'manifest.json', 'robots.txt', 'service-worker.js', 'VERSION.txt',
    'css', 'js', 'libs', 'image'
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const entry of ENTRIES) {
    cpSync(join(root, entry), join(outDir, entry), {
        recursive: true,
        filter: src => !src.endsWith('.psd') && !src.endsWith('tailwind.src.css')
    });
}

// Tailwind 只生成页面与脚本中用到的类名
execFileSync(join(root, 'node_modules/.bin/tailwindcss'), [
    '-i', join(root, 'css/tailwind.src.css'),
    '-o', join(outDir, 'css/tailwind.css'),
    '--minify'
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

console.log(`已构建到 ${outDir}`);
