// 把仓库根目录中的前端静态文件复制到 mobile/www，作为 Capacitor 的 webDir。
// 服务端代码（server.mjs、functions/、api/ 等）不进入 App。
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileDir, '..');
const outDir = join(mobileDir, 'www');

const entries = [
  'index.html', 'player.html', 'watch.html', 'about.html', 'privacy.html',
  'manifest.json', 'VERSION.txt',
  'css', 'js', 'libs', 'image'
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const entry of entries) {
  cpSync(join(repoRoot, entry), join(outDir, entry), {
    recursive: true,
    filter: src => !src.endsWith('.psd')
  });
}
console.log(`已复制 ${entries.length} 项到 ${outDir}`);
