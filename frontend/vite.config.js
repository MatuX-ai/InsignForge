import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Vite 配置
// 开发时通过 Vite proxy 转发 /api 到后端,避免 CORS
// 生产环境由 nginx.conf 反向代理
//
// 注意: 不引用 process.env / import.meta.env 以避免 tsc 类型检查问题
// 如需切换后端地址,请修改此处的 target 字段
var BACKEND_TARGET = 'http://localhost:3001';
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
});
