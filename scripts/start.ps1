#!/usr/bin/env pwsh
# ============================================================
# InsightForge 一键启动脚本 (PowerShell)
# 适用于 Windows / PowerShell 5.1+ / PowerShell Core
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectRoot = (Get-Location).Path

function Write-Step($msg) {
  Write-Host ""
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')]" -ForegroundColor Cyan -NoNewline
  Write-Host " $msg" -ForegroundColor White
}

function Write-OK($msg) {
  Write-Host "  OK " -ForegroundColor Green -NoNewline
  Write-Host $msg
}

function Write-Warn($msg) {
  Write-Host "  WARN " -ForegroundColor Yellow -NoNewline
  Write-Host $msg
}

function Write-Err($msg) {
  Write-Host "  ERR " -ForegroundColor Red -NoNewline
  Write-Host $msg
}

# ---------- 1. 检查 Docker ----------
Write-Step "1/5 检查 Docker 环境"
try {
  $dockerVersion = docker --version 2>&1
  Write-OK "$dockerVersion"
} catch {
  Write-Err "未检测到 Docker。请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop"
  exit 1
}

try {
  $composeVersion = docker compose version 2>&1
  Write-OK "Docker Compose: $composeVersion"
} catch {
  Write-Err "当前 Docker 版本不支持 'docker compose' 子命令。请升级到 Docker Desktop 4.13+"
  exit 1
}

# ---------- 2. 准备 .env ----------
Write-Step "2/5 准备环境变量"
if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Write-OK "已从 .env.example 创建 .env"
  } else {
    Write-Err ".env.example 不存在"
    exit 1
  }
} else {
  Write-OK ".env 已存在"
}

# 检查 API Key 是否已配置
$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch 'DEEPSEEK_API_KEY=.+' -and $envContent -notmatch 'OPENAI_API_KEY=.+') {
  Write-Warn "未检测到任何 LLM API Key"
  Write-Host "    请编辑 .env 文件,填入 DEEPSEEK_API_KEY 或 OPENAI_API_KEY" -ForegroundColor Yellow
  $continue = Read-Host "    是否仍要继续启动? (y/N)"
  if ($continue -ne 'y' -and $continue -ne 'Y') {
    exit 1
  }
} else {
  Write-OK "已检测到 LLM API Key"
}

# ---------- 3. 构建镜像 ----------
Write-Step "3/5 构建 Docker 镜像(首次约 5-10 分钟)"
docker compose build
if ($LASTEXITCODE -ne 0) {
  Write-Err "镜像构建失败,查看上方日志"
  exit 1
}
Write-OK "镜像构建完成"

# ---------- 4. 启动服务 ----------
Write-Step "4/5 启动所有服务"
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Err "服务启动失败"
  exit 1
}

# ---------- 5. 等待就绪 ----------
Write-Step "5/5 等待服务就绪"
$maxWait = 60
$elapsed = 0
while ($elapsed -lt $maxWait) {
  try {
    $null = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 2
    Write-OK "后端已就绪"
    break
  } catch {
    Start-Sleep -Seconds 2
    $elapsed += 2
    Write-Host "." -NoNewline
  }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  InsightForge 启动成功!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  浏览器访问:" -ForegroundColor White
Write-Host "    http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  服务端口:" -ForegroundColor White
Write-Host "    前端:  3000" -ForegroundColor Cyan
Write-Host "    后端:  3001" -ForegroundColor Cyan
Write-Host "    OpenSerp: 8080" -ForegroundColor Cyan
Write-Host ""
Write-Host "  常用命令:" -ForegroundColor White
Write-Host "    查看日志:" -ForegroundColor Gray
Write-Host "      docker compose logs -f" -ForegroundColor Gray
Write-Host "    停止服务:" -ForegroundColor Gray
Write-Host "      docker compose down" -ForegroundColor Gray
Write-Host "    重置数据:" -ForegroundColor Gray
Write-Host "      Remove-Item .\data\insightforge.db" -ForegroundColor Gray
Write-Host ""