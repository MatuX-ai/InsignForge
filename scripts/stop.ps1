#!/usr/bin/env pwsh
# 停止所有服务(保留数据)
$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -Path ".."
docker compose down
Write-Host "已停止 InsightForge 所有服务。数据保留在 .\data\ 目录下。" -ForegroundColor Green