import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 静态站配置:输出纯静态 SPA
// - 通过 base 配置支持子路径部署(如 GitHub Pages 的 /insightforge/)
// - 默认基础路径 './',既可部署到根域名也可部署到子路径
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
  },
});