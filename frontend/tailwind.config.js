/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 严格按 docs/02-前端设计文档.md §2.3
        primary: '#2563EB',
        success: '#16A34A',
        warning: '#D97706',
        'text-primary': '#111827',
        'text-secondary': '#6B7280',
        bg: '#F8FAFC',
        card: '#FFFFFF',
        border: '#E5E7EB',
        'hover-bg': '#F1F5F9',
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
        // 严格按前端文档 §2.3
        title: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        section: ['18px', { lineHeight: '28px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '24px', fontWeight: '400' }],
        helper: ['13px', { lineHeight: '20px', fontWeight: '400' }],
        label: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        card: '8px',
      },
    },
  },
  plugins: [],
};