<#
.SYNOPSIS
  Launch InsightForge desktop app and capture GUI diagnostic logs.

.DESCRIPTION
  - Starts electron via Start-Process so the GUI process is detached from this shell.
  - Redirects stdout -> desktop-start.log, stderr -> desktop-start.err.log
    so the logs survive even if the PowerShell session ends.
  - Polls the stdout log for the backend-ready signal (up to -TimeoutSec).
  - After the backend reports ready, holds for a short settle period so the
    BrowserWindow has a chance to render, then captures tail diagnostics.
  - Performs heuristic log scanning for the most common GUI startup failures
    (GPU process crash, winCodeSign, icon load, EACCES, EADDRINUSE, etc).

.PARAMETER TimeoutSec
  Maximum seconds to wait for the backend-ready signal before giving up.

.PARAMETER NoWait
  Launch electron and exit immediately without waiting or scanning logs.

.EXAMPLE
  # typical usage from an OUTSIDE PowerShell terminal (NOT the QoderCN sandbox):
  cd e:\Dady_project\InsignForge\desktop
  powershell -ExecutionPolicy Bypass -File .\start-debug.ps1

.EXAMPLE
  # fire-and-forget: launch and let logs accumulate, then read them yourself:
  powershell -ExecutionPolicy Bypass -File .\start-debug.ps1 -NoWait
  # ... after the window appears or fails ...
  Get-Content .\desktop-start.log -Tail 200

.NOTES
  The QoderCN sandbox cannot host GUI windows. You MUST run this script from
  a normal Windows PowerShell host (Win+R -> powershell, or Windows Terminal)
  for the BrowserWindow to actually appear on your desktop.
#>

[CmdletBinding()]
param(
    [int]$TimeoutSec = 60,
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

# ---- paths ----
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$stdoutLog = Join-Path $scriptRoot 'desktop-start.log'
$stderrLog = Join-Path $scriptRoot 'desktop-start.err.log'
$combinedLog = Join-Path $scriptRoot 'desktop-start.combined.log'

# ---- preflight: required resources ----
$missing = @()
foreach ($rel in @(
    'resources\backend\dist\index.js',
    'resources\frontend-dist\index.html',
    'build\icon.png'
)) {
    if (-not (Test-Path (Join-Path $scriptRoot $rel))) { $missing += $rel }
}
if ($missing.Count -gt 0) {
    Write-Host '[preflight] missing resources:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "[preflight] run 'node build.mjs' first to repackage resources." -ForegroundColor Yellow
    exit 1
}

# ---- preflight: clear stale logs and stale electron processes ----
foreach ($f in @($stdoutLog, $stderrLog, $combinedLog)) {
    if (Test-Path $f) { Remove-Item $f -Force }
}

$stale = Get-Process -Name 'electron' -ErrorAction SilentlyContinue
if ($stale) {
    Write-Host "[preflight] killing $($stale.Count) stale electron process(es)..." -ForegroundColor Yellow
    $stale | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# ---- locate electron binary ----
# ⚠️ 不能直接 Start-Process 'node_modules\.bin\electron.cmd' —— 该 .cmd 包装脚本会把
# 第一个参数 'electron' 透传给 cli.js,被解析成应用路径(指向 desktop\electron),
# 触发 "Unable to find Electron app"。所以这里直接调用 electron 二进制本身,
# 仅把 '.' 作为应用路径传给 cli。
$electronExe = Join-Path $scriptRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electronExe)) {
    Write-Host '[start] node_modules\electron\dist\electron.exe not found locally, falling back to electron.cmd' -ForegroundColor Yellow
    $electronExe = Join-Path $scriptRoot 'node_modules\.bin\electron.cmd'
}

Write-Host ''
Write-Host '[start] command : ' -NoNewline
Write-Host "$electronExe ."
Write-Host "[start] stdout  : $stdoutLog"
Write-Host "[start] stderr  : $stderrLog"
Write-Host "[start] timeout : ${TimeoutSec}s"
Write-Host ''

# ---- launch electron ----
$proc = Start-Process -FilePath $electronExe `
                      -ArgumentList '.' `
                      -WorkingDirectory $scriptRoot `
                      -RedirectStandardOutput $stdoutLog `
                      -RedirectStandardError  $stderrLog `
                      -PassThru `
                      -WindowStyle Normal

Write-Host "[start] electron launched, PID = $($proc.Id)"
Write-Host ''

if ($NoWait) {
    Write-Host '[start] -NoWait set; returning to shell now.'
    Write-Host '         tail logs later with:'
    Write-Host "           Get-Content '$stdoutLog' -Tail 100 -Wait"
    exit 0
}

# ---- wait for backend-ready signal ----
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ready    = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    if (Test-Path $stdoutLog) {
        $tail = Get-Content $stdoutLog -Tail 200 -Raw -ErrorAction SilentlyContinue
        if ($tail -and $tail -match '后端就绪|backend.*ready|InsightForge 后端已启|EADDRINUSE|GPU process exited|Failed to load module') {
            $ready = $true
            break
        }
    }
}

if (-not $proc.HasExited) {
    Write-Host "[wait] backend-ready signal detected. Letting GUI settle for 8s..." -ForegroundColor Cyan
    Start-Sleep -Seconds 8
}

# ---- decide: hold or exit ----
if (-not $proc.HasExited) {
    Write-Host "[hold] GUI process still running (PID=$($proc.Id))." -ForegroundColor Green
    Write-Host "[hold] If a window appeared on your desktop, close it to flush logs."
    Write-Host "[hold] If NO window appeared, kill it now so we can read the tail:"
    Write-Host "         Stop-Process -Id $($proc.Id) -Force"
    Write-Host "[hold] Auto-waiting up to 5 minutes for the window to close..."
    $proc.WaitForExit(300000) | Out-Null
}

# ---- emit combined log for easy paste-back ----
$combined = ''
if (Test-Path $stdoutLog) { $combined += "`n===== desktop-start.log =====`n" + (Get-Content $stdoutLog -Raw -ErrorAction SilentlyContinue) }
if (Test-Path $stderrLog) { $combined += "`n===== desktop-start.err.log =====`n" + (Get-Content $stderrLog -Raw -ErrorAction SilentlyContinue) }
$combined | Out-File -FilePath $combinedLog -Encoding utf8

# ---- summary ----
$exit = if ($proc.HasExited) { $proc.ExitCode } else { 'still running' }
Write-Host ''
Write-Host '========== launch summary =========='
Write-Host ("PID         : {0}" -f $proc.Id)
Write-Host ("exit code   : {0}" -f $exit)
Write-Host ("stdout size : {0} bytes" -f (if (Test-Path $stdoutLog) { (Get-Item $stdoutLog).Length } else { 0 }))
Write-Host ("stderr size : {0} bytes" -f (if (Test-Path $stderrLog) { (Get-Item $stderrLog).Length } else { 0 }))
Write-Host ("combined    : {0}" -f $combinedLog)
Write-Host '===================================='
Write-Host ''

# ---- print tail of stdout ----
if (Test-Path $stdoutLog) {
    Write-Host '----- desktop-start.log (tail 120 lines) -----'
    Get-Content $stdoutLog -Tail 120
    Write-Host '----- end stdout -----'
    Write-Host ''
}

# ---- print tail of stderr ----
if (Test-Path $stderrLog) {
    Write-Host '----- desktop-start.err.log (tail 80 lines) -----'
    Get-Content $stderrLog -Tail 80
    Write-Host '----- end stderr -----'
    Write-Host ''
}

# ---- heuristic hints ----
$scanText = $combined
Write-Host '----- heuristic hints -----'
$hits = 0

if ($scanText -match 'GPU process exited|failed to create GPU|swiftshader|GLES driver') {
    Write-Host '[hint] GPU process crashed. Re-run with --disable-gpu --disable-software-rasterizer' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'winCodeSign|code signing|signtool') {
    Write-Host '[hint] winCodeSign / code-signing issue. Verify electron-builder cache is intact.' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'icon\.png|invalid icon|EINVAL.*icon|setIcon') {
    Write-Host '[hint] Window icon failed to load. Verify build\icon.png exists and is a valid PNG.' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'EBADF|EACCES|access is denied|EIO') {
    Write-Host '[hint] File permission / IO error. Close antivirus or retry as Administrator.' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'Cannot find module|MODULE_NOT_FOUND') {
    Write-Host '[hint] Missing module. Run: npm install --no-audit' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'DevTools listening') {
    Write-Host '[hint] DevTools is up; window is very likely visible.' -ForegroundColor Green
    $hits++
}
if ($scanText -match 'EADDRINUSE') {
    Write-Host '[hint] Port already in use. Stop other electron / backend processes first.' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match '404|ERR_FILE_NOT_FOUND|net::ERR_') {
    Write-Host '[hint] Renderer-side file/network error. Check resources\frontend-dist contents.' -ForegroundColor Yellow
    $hits++
}
if ($scanText -match 'backend.*ready|后端就绪' -and $hits -eq 0) {
    Write-Host '[info] Backend reported ready; window should have rendered. If you saw nothing, paste logs back.' -ForegroundColor Cyan
    $hits++
}

if ($hits -eq 0) {
    Write-Host '(no heuristic match; please paste desktop-start.combined.log back for manual diagnosis)' -ForegroundColor DarkGray
}
Write-Host ''

Write-Host '===================================================' -ForegroundColor Cyan
Write-Host 'Next step:' -ForegroundColor Cyan
Write-Host '  Copy the contents of:' -ForegroundColor Cyan
Write-Host "    $combinedLog" -ForegroundColor White
Write-Host '  and paste it back here. I will pinpoint the exact GUI failure.' -ForegroundColor Cyan
Write-Host '===================================================' -ForegroundColor Cyan
