<#
.SYNOPSIS
  修复 InsightForge 桌面版图标脚本
.DESCRIPTION
  流程 (顺序敏感, 不要调整):
    1. 复制源 PNG 到 desktop/build/icon.png
    2. 生成多尺寸 ICO 到 desktop/build/icon.ico 和 dist/.icon-ico/icon.ico
    3. electron-builder --win 打包 (用最新 ICO; signAndEditExecutable:false 跳过 rcedit)
    4. rcedit 仅嵌入到 win-unpacked/InsightForge.exe
       ⚠️ NSIS / portable 不走 rcedit (v0.2.0 会把安装器从 101MB 砍成 100KB 空壳,
          损坏追加的 .ndata payload). NSIS MUI 图标靠 electron-builder.yml 的
          nsis.installerIcon / nsis.uninstallerIcon 配置嵌入.

  关键: rcedit 必须在 electron-builder 之后! 否则 electron-builder 会重建产物覆盖图标.
#>

$ErrorActionPreference = 'Stop'
Set-Location 'e:\Dady_project\InsignForge\desktop'

$srcPng    = 'e:\Dady_project\InsignForge\InsightForge -Favicon.png'
$buildIcon = 'e:\Dady_project\InsignForge\desktop\build\icon.png'
$buildIco  = 'e:\Dady_project\InsignForge\desktop\build\icon.ico'
$distIco   = 'e:\Dady_project\InsignForge\desktop\dist\.icon-ico\icon.ico'

# ---------- 1. 复制源 PNG ----------
Write-Host "`n=== 1. 复制源 PNG ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Path (Split-Path $buildIcon) -Force | Out-Null
Copy-Item -Path $srcPng -Destination $buildIcon -Force
Write-Host "  $($srcPng) -> $($buildIcon)"
Write-Host "  大小: $((Get-Item $buildIcon).Length) 字节"

# ---------- 2. 生成多尺寸 ICO (两份: build/ + dist/) ----------
Write-Host "`n=== 2. 生成多尺寸 ICO (build/ + dist/) ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Path (Split-Path $buildIco) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $distIco)  -Force | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'e:\Dady_project\InsignForge\desktop\scripts\make-multi-ico.ps1' `
  -PngPath $buildIcon `
  -Output $distIco
Copy-Item -Path $distIco -Destination $buildIco -Force
Write-Host "  build/icon.ico: $((Get-Item $buildIco).Length) 字节"

# 2.5 生成单尺寸 256x256 ICO — rcedit v0.2.0 不善处理 multi-size PNG ICO
Write-Host "`n=== 2.5 生成单尺寸 ICO (rcedit 专用) ===" -ForegroundColor Cyan
$distIcoSingle = 'e:\Dady_project\InsignForge\desktop\dist\.icon-ico\icon-256.ico'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'e:\Dady_project\InsignForge\desktop\scripts\make-single-ico.ps1' `
  -PngPath $buildIcon `
  -Output $distIcoSingle `
  -Size 256
Write-Host "  $((Get-Item $distIcoSingle).Length) 字节"

# ---------- 3. electron-builder 打包 ----------
Write-Host "`n=== 3. electron-builder 打包 ===" -ForegroundColor Cyan
Set-Location 'e:\Dady_project\InsignForge\desktop'
& npm.cmd exec -- electron-builder --win

# ---------- 4. rcedit 自适应探测 + 仅嵌入 win-unpacked ----------
Write-Host "`n=== 4. rcedit 嵌入 (仅 win-unpacked) ===" -ForegroundColor Cyan

# 探测 rcedit: 项目内 vendored > electron-builder 缓存任意 hash 子目录
$rcedit = $null
$vendored = 'e:\Dady_project\InsignForge\desktop\resources\tools\rcedit-x64.exe'
if (Test-Path $vendored) { $rcedit = $vendored }
if (-not $rcedit) {
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
  if (Test-Path $cacheRoot) {
    $found = Get-ChildItem -Path $cacheRoot -Directory `
      | Where-Object { Test-Path (Join-Path $_.FullName 'rcedit-x64.exe') } `
      | Select-Object -ExpandProperty FullName
    if ($found) {
      $latest = $found | Sort-Object | Select-Object -Last 1
      $rcedit = Join-Path $latest 'rcedit-x64.exe'
    }
  }
}
if (-not $rcedit) {
  throw "找不到 rcedit-x64.exe (无 vendored 也无 electron-builder 缓存). 请下载到 desktop/resources/tools/rcedit-x64.exe"
}
Write-Host "  rcedit: $rcedit"

# 4.1 win-unpacked (用单尺寸 ICO 避免 rcedit 的 multi-size PNG bug)
$exe = 'e:\Dady_project\InsignForge\desktop\dist\win-unpacked\InsightForge.exe'
if (Test-Path $exe) {
  $before = (Get-Item $exe).Length
  & $rcedit $exe '--set-icon' $distIcoSingle
  Write-Host ("  win-unpacked EXE: {0:N0} -> {1:N0} 字节" -f $before, (Get-Item $exe).Length) -ForegroundColor Green
} else { Write-Warning "  找不到 win-unpacked EXE: $exe" }

# 4.2 NSIS / portable: 不 rcedit (会损坏 NSIS payload). MUI 图标靠 nsis.installerIcon 配置.
Write-Host "  NSIS / portable: 跳过 rcedit (避免损坏 NSIS 安装器), MUI 图标由 electron-builder 嵌入" -ForegroundColor Yellow

Write-Host "`n✅ 完成" -ForegroundColor Green
Get-ChildItem 'e:\Dady_project\InsignForge\desktop\dist\*.exe' |
  Select-Object Name, Length |
  Format-Table -AutoSize

Write-Host "`n[验证提示] 跑下面三个命令分别验证三个产物的图标:" -ForegroundColor Yellow
Write-Host "  node desktop/scripts/verify-exe-icon.mjs                       # win-unpacked"
Write-Host "  node desktop/scripts/verify-exe-icon.mjs --target=nsis         # NSIS 安装包"
Write-Host "  node desktop/scripts/verify-exe-icon.mjs --target=portable     # portable"
