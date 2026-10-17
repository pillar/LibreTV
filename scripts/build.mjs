// 构建网站到 dist/：Cloudflare Worker（wrangler.jsonc 的 assets）、Node server.mjs 和 App（mobile/scripts/copy-web.mjs）都只发布这个目录。
//
// - 每个页面引用的脚本按原顺序合并成一个文件（首页与播放页共用的开头部分另成 common 文件）、样式合并成一个文件，压缩后以内容哈希命名放在 dist/assets/，
//   页面改为引用合并后的文件。内容不变时文件名不变，因此可以让浏览器长期缓存（见 dist/_headers 与 server.mjs）。
// - 脚本仍是普通（非模块）脚本：合并后顶层函数和变量依旧是全局的，页面中的 data-action 调用不受影响。
// - Tailwind 只生成页面与脚本中用到的类名。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

// 端到端测试先统一构建一次，再启动 Node 版与 wrangler dev；wrangler dev 会自动执行构建命令，这里跳过以免并发清空 dist/
if (process.env.PLAYANY_SKIP_BUILD === '1') {
    console.log('已跳过构建（PLAYANY_SKIP_BUILD=1）');
    process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const assetsDir = join(outDir, 'assets');

const PAGES = ['index.html', 'player.html', 'watch.html', 'about.html', 'privacy.html'];
const STATIC_FILES = ['manifest.json', 'robots.txt', 'VERSION.txt', 'image'];
// 压缩时不使用比 ES2020 更新的语法（现有代码本身也只用到 ES2020），保证 iOS 14 / Chrome 80 等可用
const TARGET = 'es2020';

const SCRIPT_TAG = /^[ \t]*<script src="((?:js|libs)\/[^"]+)"[^>]*><\/script>[ \t]*\r?\n?/gm;
const STYLE_TAG = /^[ \t]*<link rel="stylesheet" href="(css\/[^"]+)">[ \t]*\r?\n?/gm;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });
for (const entry of STATIC_FILES) {
    cpSync(join(root, entry), join(outDir, entry), { recursive: true, filter: src => !src.endsWith('.psd') });
}

// Tailwind 先编译到临时位置，再与其他样式一起合并
const tailwindCss = join(outDir, 'tailwind.tmp.css');
execFileSync(join(root, 'node_modules/.bin/tailwindcss'), [
    '-i', join(root, 'css/tailwind.src.css'), '-o', tailwindCss, '--minify'
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

function readSource(file) {
    return file === 'css/tailwind.css' ? readFileSync(tailwindCss, 'utf8') : readFileSync(join(root, file), 'utf8');
}

// 相同内容（例如多个页面共用的样式组合）只输出一次
const written = new Map();
async function writeBundle(name, files, loader) {
    // 每个文件以换行和分号隔开，避免上一个文件末尾缺少分号时与下一个文件连在一起
    const source = files.map(file => `/* ${file} */\n${readSource(file)}\n${loader === 'js' ? ';' : ''}`).join('\n');
    const { code } = await transform(source, { loader, minify: true, target: TARGET, legalComments: 'none' });
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
    const fileName = `assets/${name}.${hash}.${loader}`;
    if (!written.has(fileName)) {
        writeFileSync(join(outDir, fileName), code);
        written.set(fileName, code.length);
    }
    return fileName;
}

// 首页与播放页开头相同的一段脚本单独打包（两个页面的脚本顺序因此保持一致），从首页进入播放页时这部分已在浏览器缓存中
const SHARED_SCRIPT_PAGES = ['index.html', 'player.html'];
const scriptsOf = page => [...readFileSync(join(root, page), 'utf8').matchAll(SCRIPT_TAG)].map(m => m[1]);
const [firstList, ...otherLists] = SHARED_SCRIPT_PAGES.map(scriptsOf);
let sharedCount = 0;
while (sharedCount < firstList.length && otherLists.every(list => list[sharedCount] === firstList[sharedCount])) sharedCount++;
const sharedScripts = firstList.slice(0, sharedCount);
const sharedBundle = sharedScripts.length ? await writeBundle('common', sharedScripts, 'js') : '';

for (const page of PAGES) {
    let html = readFileSync(join(root, page), 'utf8');
    const name = page.replace(/\.html$/, '');

    const styles = [...html.matchAll(STYLE_TAG)].map(m => m[1]);
    if (styles.length) {
        const bundle = await writeBundle(name, styles, 'css');
        let first = true;
        html = html.replace(STYLE_TAG, () => {
            if (!first) return '';
            first = false;
            return `    <link rel="stylesheet" href="${bundle}">\n`;
        });
    }

    const scripts = [...html.matchAll(SCRIPT_TAG)].map(m => m[1]);
    if (scripts.length) {
        const shared = SHARED_SCRIPT_PAGES.includes(page) ? sharedCount : 0;
        const own = scripts.slice(shared);
        const bundle = own.length ? await writeBundle(name, own, 'js') : '';
        // 公共脚本放在原来第一个公共脚本的位置，其余合并后放在原来最后一个脚本的位置
        // （各页面的脚本都位于 body 末尾或 head 中同一处）
        let index = 0;
        html = html.replace(SCRIPT_TAG, () => {
            const position = index++;
            if (shared && position === 0) return `    <script src="${sharedBundle}"></script>\n`;
            if (bundle && position === scripts.length - 1) return `    <script src="${bundle}"></script>\n`;
            return '';
        });
    }

    writeFileSync(join(outDir, page), html);
}
rmSync(tailwindCss);

// 带哈希的文件内容不会变化，允许浏览器长期缓存（Cloudflare 静态资源读取 _headers）
writeFileSync(join(outDir, '_headers'), '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');

for (const [file, size] of written) console.log(`  ${file}  ${(size / 1024).toFixed(1)} KB`);
console.log(`已构建到 ${outDir}`);
