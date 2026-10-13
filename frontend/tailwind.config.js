/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 背景色 - 米黄纸张质感
        cream: {
          DEFAULT: '#fffbf0',
          dark: '#fff4d6',
        },
        paper: '#fef8e8',

        // 主色 - 粉橙色（温暖活力）
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },

        // 辅助色 - 柔和粉色（可爱）
        accent: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
        },

        // 支出 - 活力橙色
        expense: {
          light: '#fed7aa',
          DEFAULT: '#fb923c',
          dark: '#ea580c',
        },

        // 收入 - 清新绿色
        income: {
          light: '#d1fae5',
          DEFAULT: '#10b981',
          dark: '#059669',
        },

        // 警告/提醒
        warning: {
          light: '#fef3c7',
          DEFAULT: '#fbbf24',
          dark: '#f59e0b',
        },

        // 手绘边框色
        hand: '#1f2937',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', 'sans-serif'],
        mono: ['SF Mono', 'Consolas', 'Monaco', 'monospace'],
        handwriting: ['Ma Shan Zheng', 'Zhi Mang Xing', 'cursive'],
      },
      borderWidth: {
        hand: '3px',
      },
    },
  },
  plugins: [],
}
