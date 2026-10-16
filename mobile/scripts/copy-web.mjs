// 构建网站（仓库根目录 npm run build → dist/）并复制到 mobile/www，作为 Capacitor 的 webDir。
// dist/ 中只有网站文件，服务端代码不进入 App。
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileDir, '..');
const outDir = join(mobileDir, 'www');

execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
rmSync(outDir, { recursive: true, force: true });
cpSync(join(repoRoot, 'dist'), outDir, { recursive: true });
console.log(`已复制 dist/ 到 ${outDir}`);
