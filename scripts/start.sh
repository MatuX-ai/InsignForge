#!/usr/bin/env bash
# ============================================================
# InsightForge 一键启动脚本 (Bash)
# 适用于 Linux / macOS / WSL2
# ============================================================
set -e

cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

# ---------- 颜色 ----------
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${CYAN}[$(date +'%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "  ${GREEN}OK${NC} $1"; }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }
err()  { echo -e "  ${RED}ERR${NC} $1"; }

# ---------- 1. 检查 Docker ----------
step "1/5 检查 Docker 环境"
if ! command -v docker >/dev/null 2>&1; then
  err "未检测到 Docker。请先安装:https://docs.docker.com/get-docker/"
  exit 1
fi
ok "$(docker --version)"

if ! docker compose version >/dev/null 2>&1; then
  err "当前 Docker 版本不支持 'docker compose' 子命令"
  exit 1
fi
ok "Docker Compose: $(docker compose version)"

# ---------- 2. 准备 .env ----------
step "2/5 准备环境变量"
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    ok "已从 .env.example 创建 .env"
  else
    err ".env.example 不存在"
    exit 1
  fi
else
  ok ".env 已存在"
fi

# 检查 API Key
if ! grep -qE 'DEEPSEEK_API_KEY=.+|OPENAI_API_KEY=.+' .env; then
  warn "未检测到任何 LLM API Key"
  echo "    请编辑 .env 文件,填入 DEEPSEEK_API_KEY 或 OPENAI_API_KEY"
  read -p "    是否仍要继续启动? (y/N): " continue
  if [ "$continue" != "y" ] && [ "$continue" != "Y" ]; then
    exit 1
  fi
else
  ok "已检测到 LLM API Key"
fi

# ---------- 3. 构建镜像 ----------
step "3/5 构建 Docker 镜像(首次约 5-10 分钟)"
docker compose build
ok "镜像构建完成"

# ---------- 4. 启动服务 ----------
step "4/5 启动所有服务"
docker compose up -d

# ---------- 5. 等待就绪 ----------
step "5/5 等待服务就绪"
max_wait=60
elapsed=0
while [ $elapsed -lt $max_wait ]; do
  if curl -s -f http://localhost:3001/health >/dev/null 2>&1; then
    ok "后端已就绪"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
  echo -n "."
done

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  InsightForge 启动成功!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  浏览器访问: ${CYAN}http://localhost:3000${NC}"
echo ""
echo -e "  服务端口:"
echo -e "    前端:    ${CYAN}3000${NC}"
echo -e "    后端:    ${CYAN}3001${NC}"
echo -e "    OpenSerp: ${CYAN}8080${NC}"
echo ""
echo -e "  常用命令:"
echo -e "    查看日志: docker compose logs -f"
echo -e "    停止服务: docker compose down"
echo -e "    重置数据: rm -f data/insightforge.db"
echo ""