import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置
// 开发时通过 Vite proxy 转发 /api 到后端,避免 CORS
// 生产环境由 nginx.conf 反向代理

const BACKEND_TARGET = 'http://localhost:3001';

// 修复 BUG-04: 直接利用 Vite + npm 内置环境变量,
// npm/yarn/pnpm 在执行 npm run dev/build 时会自动注入 npm_package_version = package.json 中的 version。
// 比起自己读文件,这种方式更稳健(支持 monorepo、pnpm workspaces 等场景)。
const APP_VERSION = process.env.npm_package_version ?? '0.0.0';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
});
