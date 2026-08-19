#!/usr/bin/env bash
# 停止所有服务(保留数据)
set -e
cd "$(dirname "$0")/.."
docker compose down
echo "已停止 InsightForge 所有服务。数据保留在 ./data/ 目录下。"