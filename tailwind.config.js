// 预编译 Tailwind（npm run build:css → css/tailwind.css），取代页面里运行时生成样式的 libs/tailwindcss.min.js。
// 扫描页面与脚本中出现的类名（包括 JS 里拼接的类名字符串），只生成用到的样式。
// 颜色与圆角取自 css/theme.css 中的变量（浅色 Apple 风格），页面里直接使用 bg-surface、text-ink-2 等类名。
export default {
    content: ['./*.html', './js/**/*.js'],
    theme: {
        extend: {
            colors: {
                surface: 'var(--surface)',       // 卡片、面板
                'surface-2': 'var(--surface-2)', // 分组背景
                fill: 'var(--fill)',             // 按钮、输入框等填充
                'fill-hover': 'var(--fill-hover)',
                separator: 'var(--separator)',
                ink: 'var(--ink)',               // 主要文字
                'ink-soft': 'rgba(60, 60, 67, 0.85)',
                'ink-2': 'var(--ink-2)',         // 次要文字
                'ink-3': 'var(--ink-3)',         // 辅助文字
                accent: 'var(--blue)',           // 次要按钮的文字（系统蓝）
                danger: 'var(--red)'
            },
            borderRadius: { lg: 'var(--radius-md)' }
        }
    },
    plugins: []
};
