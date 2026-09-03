# ============================================================
#  refresh-taskbar-icon.ps1
#  刷新 InsightForge 的 Windows 任务栏图标
# ============================================================
#
#  适用场景: 升级后任务栏固定项仍显示旧版本的图标.
#
#  原因: Windows Explorer 为每个任务栏固定项维护独立的 .lnk 文件,
#         .lnk 里嵌入的图标是创建时的快照, NSIS 升级不会替换它.
#         即使 rcedit 已经更新了 InsightForge.exe 的图标资源,
#         Explorer 仍按 .lnk 缓存显示.
#
#  本脚本做三件事:
#    1. 删除任务栏固定位置的旧 .lnk (Win7/8/10/11 通用路径)
#    2. 删除 Windows 图标缓存 (IconCache.db), 强制 Explorer 重抽
#    3. 杀掉 explorer.exe 再启动, 让缓存生效
#
#  之后: 启动一次 InsightForge, 在任务栏上右键 → "固定到任务栏"
#        任务栏图标就会是新版的 InsightForge LOGO.
#
#  用法: 在 PowerShell 中运行 (无需管理员权限)
#         .\refresh-taskbar-icon.ps1
#         或右键 → "使用 PowerShell 运行"
#
# ⚠️ 关闭后所有 File Explorer 窗口会被强制重启, 请先保存工作.
# ============================================================

$ErrorActionPreference = 'Continue'

# 1. 任务栏固定项路径 (所有 Windows 版本统一)
$taskbarPaths = @(
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge.lnk",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.2.lnk",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.3.lnk",
  "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\InsightForge 0.1.4.lnk"
)

Write-Host "================================================"
Write-Host "  InsightForge 任务栏图标刷新脚本"
Write-Host "================================================"
Write-Host ""
Write-Host "⚠️  本脚本会强制重启 Windows Explorer 进程,"
Write-Host "    所有打开的 File Explorer 窗口都会被关闭."
Write-Host "    请先保存所有未保存的工作."
Write-Host ""

$confirm = Read-Host "确认运行? (yes/no, 默认 yes)"
if ($confirm -notin @('', 'y', 'Y', 'yes', 'YES', 'Yes')) {
  Write-Host "已取消."
  exit 0
}

# 2. 删除任务栏固定项
Write-Host ""
Write-Host "[1/3] 删除任务栏固定项..."
$taskbarRemoved = 0
foreach ($p in $taskbarPaths) {
  if (Test-Path $p) {
    try {
      Remove-Item -LiteralPath $p -Force
      Write-Host "  ✓ 已删除: $p"
      $taskbarRemoved++
    } catch {
      Write-Host "  ✗ 删除失败: $p ($($_.Exception.Message))"
    }
  }
}
if ($taskbarRemoved -eq 0) {
  Write-Host "  (未发现旧任务栏固定项, 跳过)"
}

# 3. 删除 Windows 图标缓存
Write-Host ""
Write-Host "[2/3] 清除图标缓存..."
$iconCache = "$env:LOCALAPPDATA\IconCache.db"
if (Test-Path $iconCache) {
  try {
    Remove-Item -LiteralPath $iconCache -Force
    Write-Host "  ✓ 已删除: $iconCache"
  } catch {
    Write-Host "  ⚠️ 无法删除 IconCache.db (文件被占用)"
    Write-Host "      跳过此步, 重启后 Explorer 会自动失效"
  }
} else {
  Write-Host "  (IconCache.db 不存在, 跳过)"
}

# 4. 重启 Explorer 让缓存失效
Write-Host ""
Write-Host "[3/3] 重启 Windows Explorer..."
$explorer = Get-Process -Name explorer -ErrorAction SilentlyContinue
if ($explorer) {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-Process explorer
  Write-Host "  ✓ Explorer 已重启"
} else {
  Write-Host "  (Explorer 未运行, 跳过)"
}

Write-Host ""
Write-Host "================================================"
Write-Host "  完成!"
Write-Host ""
Write-Host "  下一步:"
Write-Host "    1. 启动一次 InsightForge (portable 或已装版本)"
Write-Host "    2. 在任务栏上新出现的 InsightForge 图标右键"
Write-Host "       → '固定到任务栏'"
Write-Host "    3. 任务栏图标现在已是最新的 InsightForge LOGO"
Write-Host "================================================"

