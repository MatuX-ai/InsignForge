# ============================================================
# InsightForge Frontend Dockerfile
# 多阶段构建:Vite 构建静态文件 + nginx 提供服务
# ============================================================

# ---------- 阶段 1: 构建 ----------
FROM node:22-alpine AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
RUN npm run build

# ---------- 阶段 2: nginx 提供静态服务 ----------
FROM nginx:1.27-alpine AS runtime

# 替换默认配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]