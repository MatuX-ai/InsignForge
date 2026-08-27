/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 深色主题配色
        primary: '#6366F1', // 靛蓝紫主色
        'primary-light': '#818CF8',
        'primary-dark': '#4F46E5',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        'text-primary': '#F1F5F9',
        'text-secondary': '#94A3B8',
        'text-tertiary': '#64748B',
        bg: '#0F172A', // 深蓝黑背景
        'bg-secondary': '#1E293B', // 次级背景
        card: 'rgba(30, 41, 59, 0.7)', // 玻璃拟态卡片背景
        'card-solid': '#1E293B', // 实色卡片背景
        border: 'rgba(148, 163, 184, 0.15)', // 玻璃边框
        'border-solid': '#334155', // 实色边框
        'hover-bg': 'rgba(51, 65, 85, 0.5)',
        accent: '#A78BFA', // 紫色点缀
        cyan: '#22D3EE', // 青色点缀
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        display: ['32px', { lineHeight: '40px', fontWeight: '700' }],
        title: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        section: ['18px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '24px', fontWeight: '400' }],
        helper: ['13px', { lineHeight: '20px', fontWeight: '400' }],
        label: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        card: '12px',
        lg: '16px',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.3)',
        glow: '0 0 20px rgba(99, 102, 241, 0.3)',
        'glow-sm': '0 0 10px rgba(99, 102, 241, 0.2)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient':
          'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99, 102, 241, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.6)' },
        },
      },
    },
  },
  plugins: [],
};
