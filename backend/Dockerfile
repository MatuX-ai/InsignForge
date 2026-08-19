# ============================================================
# InsightForge Backend Dockerfile
# 多阶段构建: builder 编译 TypeScript,runtime 仅保留 dist + deps
# ============================================================

# ---------- 阶段 1: 构建 ----------
FROM node:22-alpine AS builder

WORKDIR /app

# 更好的国内镜像加速
RUN npm config set registry https://registry.npmmirror.com

# 仅先复制依赖清单,利用 Docker 层缓存
COPY package.json ./
RUN npm install --no-audit --no-fund

# 复制源码并编译
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 清理 devDependencies,保留运行时依赖
RUN npm prune --omit=dev

# ---------- 阶段 2: 运行 ----------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# 仅复制运行时所需文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# 数据目录(将由 docker-compose 卷挂载)
RUN mkdir -p /app/data

EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]