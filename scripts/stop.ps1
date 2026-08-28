#!/usr/bin/env pwsh
# Stop all services (preserve data)
$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -Path ".."
docker compose down
Write-Host "InsightForge services stopped. Data preserved in .\data\." -ForegroundColor Green