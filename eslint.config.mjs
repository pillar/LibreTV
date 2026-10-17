// 代码检查：npm run lint（npm test 会先运行）。
// 前端 js/*.js 是普通脚本，构建时按页面中的顺序合并（scripts/build.mjs），文件之间通过顶层的全局函数 / 变量互相调用，
// 所以把所有前端文件（以及构建时合并进来的 lib/target-guard.mjs）的顶层声明都登记为全局变量，
// 这样 no-undef 能发现调用了不存在（已删除、改名）的函数，no-unused-vars 能发现文件内没用到的变量。
import js from '@eslint/js';
import globals from 'globals';
import * as espree from 'espree';
import { readdirSync, readFileSync } from 'node:fs';

const BROWSER_SCRIPTS = readdirSync('js').filter(name => name.endsWith('.js')).map(name => `js/${name}`);
const SHARED_MODULES = ['lib/target-guard.mjs'];

function topLevelNames(file) {
    const source = readFileSync(file, 'utf8');
    const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: file.endsWith('.mjs') ? 'module' : 'script' });
    const names = [];
    for (let node of ast.body) {
        if (node.type === 'ExportNamedDeclaration' && node.declaration) node = node.declaration;
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.push(node.id.name);
        if (node.type === 'VariableDeclaration') {
            for (const declaration of node.declarations) if (declaration.id.type === 'Identifier') names.push(declaration.id.name);
        }
    }
    return names;
}

const projectGlobals = Object.fromEntries(
    [...BROWSER_SCRIPTS, ...SHARED_MODULES].flatMap(topLevelNames).map(name => [name, 'writable'])
);

export default [
    { ignores: ['dist/', 'libs/', 'mobile/', 'node_modules/', 'test-results/', 'playwright-report/', '.wrangler/'] },
    js.configs.recommended,
    { rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...projectGlobals,
                // libs/ 中的第三方库
                Hls: 'readonly',
                Artplayer: 'readonly'
            }
        },
        rules: {
            // 顶层声明供其他文件使用，只检查函数内部
            'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
            // 顶层声明同时登记为全局变量，不算重复声明
            'no-redeclare': ['error', { builtinGlobals: false }]
        }
    },
    {
        files: ['lib/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.js', '*.mjs', '*.js'],
        languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] }
    },
    {
        // 测试中 page.evaluate 的代码在页面里运行，可以使用前端的全局函数
        files: ['tests/**/*.js'],
        languageOptions: { globals: projectGlobals }
    }
];
