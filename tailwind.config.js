// 预编译 Tailwind（npm run build:css → css/tailwind.css），取代页面里运行时生成样式的 libs/tailwindcss.min.js。
// 扫描页面与脚本中出现的类名（包括 JS 里拼接的类名字符串），只生成用到的样式。
export default {
    content: ['./*.html', './js/**/*.js'],
    theme: { extend: {} },
    plugins: []
};
