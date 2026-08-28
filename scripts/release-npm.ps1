# scripts/release-npm.ps1
# Publish insightforge-dsh-plugin v0.1.0 to npm
# Usage (run in an interactive PowerShell terminal):
#   cd e:\Dady_project\InsignForge\dsh-plugin\insightforge-dsh-plugin
#   powershell -ExecutionPolicy Bypass -File ..\..\scripts\release-npm.ps1
#
# You can also provide credentials via environment variables:
#   $env:NPM_TOKEN = 'npm_xxx'
#   powershell -ExecutionPolicy Bypass -File ..\..\scripts\release-npm.ps1

$ErrorActionPreference = 'Stop'

$npmCmd = 'e:\nodejs\npm.cmd'
if (-not (Test-Path $npmCmd)) { $npmCmd = 'npm' }

$pluginDir = Join-Path $PSScriptRoot '..\dsh-plugin\insightforge-dsh-plugin'
$pluginDir = (Resolve-Path $pluginDir).Path

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host 'InsightForge dsh Plugin — npm publish v0.1.0' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "Plugin dir: $pluginDir"

Set-Location $pluginDir

# ---------- 1. Pre-checks ----------
Write-Host ''
Write-Host '[1/5] Pre-checks' -ForegroundColor Cyan

$pkgJson = Get-Content 'package.json' -Raw | ConvertFrom-Json
Write-Host "  Name:    $($pkgJson.name)"
Write-Host "  Version: $($pkgJson.version)"

if ($pkgJson.version -ne '0.1.0') {
    Write-Host "  EXPECTED v0.1.0, GOT $($pkgJson.version)" -ForegroundColor Red
    $ans = Read-Host -Prompt 'Continue anyway? (y/N)'
    if ($ans -notin @('y', 'Y', 'yes', 'YES')) { exit 1 }
}

if (-not (Test-Path 'dist/index.js')) {
    Write-Host '  dist/index.js missing, building...' -ForegroundColor Yellow
    & 'e:\nodejs\npm.cmd' run build
    if ($LASTEXITCODE -ne 0) { Write-Host 'BUILD FAILED' -ForegroundColor Red; exit 1 }
}

# ---------- 2. Login check ----------
Write-Host ''
Write-Host '[2/5] npm credentials' -ForegroundColor Cyan

$authToken = $env:NPM_TOKEN
if ($authToken) {
    Write-Host '  Using NPM_TOKEN env var' -ForegroundColor Green
    # Write temporary .npmrc
    $npmrc = Join-Path $env:USERPROFILE '.npmrc'
    $existing = if (Test-Path $npmrc) { Get-Content $npmrc -Raw } else { '' }
    $cleaned = ($existing -split "`n" | Where-Object { $_ -notmatch '^//registry.npmjs.org/:_authToken=' }) -join "`n"
    $cleaned + "`n//registry.npmjs.org/:_authToken=$authToken`n" | Set-Content $npmrc -NoNewline
} else {
    Write-Host '  Checking existing login...'
    $whoami = & $npmCmd whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  Not logged in.' -ForegroundColor Yellow
        $ans = Read-Host -Prompt 'Run npm login now? (Y/n)'
        if ($ans -in @('n', 'N', 'no', 'NO')) {
            Write-Host '  ABORTED. Run: npm login' -ForegroundColor Yellow
            exit 0
        }
        & $npmCmd login
        if ($LASTEXITCODE -ne 0) { Write-Host 'LOGIN FAILED' -ForegroundColor Red; exit 1 }
    } else {
        Write-Host "  Already logged in as: $whoami" -ForegroundColor Green
    }
}

# ---------- 3. Dry run ----------
Write-Host ''
Write-Host '[3/5] Dry-run npm publish (--dry-run)' -ForegroundColor Cyan
& $npmCmd publish --dry-run --access public 2>&1 | Select-Object -Last 40

if ($LASTEXITCODE -ne 0) {
    Write-Host 'DRY-RUN FAILED' -ForegroundColor Red
    $ans = Read-Host -Prompt 'Continue with real publish? (y/N)'
    if ($ans -notin @('y', 'Y', 'yes', 'YES')) { exit 1 }
}

# ---------- 4. Confirm ----------
Write-Host ''
Write-Host '[4/5] Confirm publish' -ForegroundColor Cyan
Write-Host "  Name:    $($pkgJson.name)" -ForegroundColor White
Write-Host "  Version: $($pkgJson.version)" -ForegroundColor White
Write-Host "  Access:  public" -ForegroundColor White
$ans = Read-Host -Prompt 'PROCEED? (y/N)'
if ($ans -notin @('y', 'Y', 'yes', 'YES')) {
    Write-Host 'ABORTED' -ForegroundColor Yellow
    exit 0
}

# ---------- 5. Publish ----------
Write-Host ''
Write-Host '[5/5] npm publish' -ForegroundColor Cyan
& $npmCmd publish --access public 2>&1 | Tee-Object -Variable pubOut

if ($LASTEXITCODE -ne 0) {
    Write-Host 'PUBLISH FAILED' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '=== npm publish completed ===' -ForegroundColor Green
Write-Host ("URL: https://www.npmjs.com/package/{0}/v/{1}" -f $pkgJson.name, $pkgJson.version)
Write-Host ''
Write-Host 'Verify:'
Write-Host "  npm view $($pkgJson.name)@$($pkgJson.version)"
Write-Host "  npm install -g $($pkgJson.name)@$($pkgJson.version)"