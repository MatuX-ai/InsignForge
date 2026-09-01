# scripts/release-v1.3.0.ps1
# InsightForge v1.3.0 发布脚本
# 执行前请确认:
#   1. 工作区已切换到 main 分支且 git status 干净(全部未提交改动应为本次发布所用)
#   2. 已登录 npm 与 GitHub CLI(gh auth status)
#   3. 已设置 NODE 版本 >= 22
#
# 使用:
#   cd e:\Dady_project\InsignForge
#   powershell -ExecutionPolicy Bypass -File .\scripts\release-v1.3.0.ps1

$ErrorActionPreference = 'Stop'

$NPM = 'e:\nodejs\npm.cmd'
if (-not (Test-Path $NPM)) { $NPM = 'npm.cmd' }

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Done($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [X] $msg" -ForegroundColor Red }

# ---------- 前置确认 ----------
Step '0/8 Pre-flight'

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Fail "当前分支: $branch (期望 main),中止"; exit 1 }
Done "Branch: $branch"

$tagExists = (& git tag -l v1.3.0).Trim()
if ($tagExists) { Fail "tag v1.3.0 已存在,请先删除或改用其它版本号"; exit 1 }
Done "Tag v1.3.0 未占用"

# ---------- 1. Build core ----------
Step '1/8 Build @insightforge/core'
Push-Location packages/core
& $NPM run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'core build failed'; Pop-Location; exit 1 }
Done 'core dist generated'
Pop-Location

# ---------- 2. Build mcp-server ----------
Step '2/8 Build @insightforge/mcp-server'
Push-Location packages/mcp-server
& $NPM run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'mcp-server build failed'; Pop-Location; exit 1 }
Done 'mcp-server dist generated'
Pop-Location

# ---------- 3. Typecheck (workspaces) ----------
Step '3/8 Typecheck (workspaces)'
& $NPM run typecheck 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'typecheck failed'; exit 1 }
Done 'Typecheck passed'

# ---------- 4. Test (workspaces) ----------
Step '4/8 Test (workspaces)'
& $NPM test 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'tests failed'; exit 1 }
Done 'All workspace tests passed'

# ---------- 5. Publish @insightforge/core@0.1.1 ----------
Step '5/8 Publish @insightforge/core@0.1.1'
Push-Location packages/core
$whoami = & $NPM whoami 2>&1
if ($LASTEXITCODE -ne 0) { Fail '未登录 npm'; Pop-Location; exit 1 }
Done "Logged in as: $whoami"
& $NPM publish --access public 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'core publish failed'; Pop-Location; exit 1 }
Done '@insightforge/core@0.1.1 published'
Pop-Location

# ---------- 6. Publish @insightforge/mcp-server@0.1.1 ----------
Step '6/8 Publish @insightforge/mcp-server@0.1.1'
Push-Location packages/mcp-server
& $NPM publish --access public 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'mcp-server publish failed'; Pop-Location; exit 1 }
Done '@insightforge/mcp-server@0.1.1 published'
Pop-Location

# ---------- 7. Push + tag ----------
Step '7/8 Git push + tag v1.3.0'
& git push origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'git push failed'; exit 1 }
Done 'main pushed'

& git tag -a v1.3.0 -m 'InsightForge v1.3.0: 可观测性 + 可靠性基座 + 配额与监控'
& git push origin v1.3.0 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'tag push failed'; exit 1 }
Done 'tag v1.3.0 pushed'

# ---------- 8. GitHub Release ----------
Step '8/8 Create GitHub Release v1.3.0'

$body = @'
## InsightForge v1.3.0

可观测性、用户可控性、采集引擎健壮性增强同步上。

### 多源采集引擎可靠性基座

- 重试（指数退避 2 次，仅对 5xx / 429 / 网络错误）/ 熔断（连续 5 败自动开 30s）/ 去重（URL 归一化 + 标题指纹）/ 进程内 TTL 缓存 / 关键词维度信号量限流
- 新增 8 类 `SourceError.kind`,按 `retryable` 决定是否重试

### 健康检查 API

- `GET /api/v1/health/sources` 返回四个源 (OpenSerp / SerpApi / Reddit / HackerNews) 的实时指标快照 (`success / failure / successRate / avgLatencyMs / cacheHits / circuitOpened / state`)
- 熔断状态 (`state: 'open'`) 实时可见

### SourceContributionCard & Monitor 页

- 报告页底部新增 `SourceContributionCard`,展示本次调研各源命中占比与平均延迟
- 新增 `/monitor` 页面供管理员查看实时源快照

### 错误消息人性化

- 新增 `frontend/src/lib/errorMessages.ts`,把 `SourceError.kind` 翻译为中文提示(如"限流请稍后重试"、"源暂时熔断")

### NPM 包同步

- `@insightforge/core@0.1.1`(与仓库 v1.3.0 同步发版,接口不变)
- `@insightforge/mcp-server@0.1.1`(tools 列表不变)

### 工程与测试

- 12 个新测试文件,新增 ~89 个测试用例,后端覆盖率阈值抬到 80%
- 依赖新增 `express-session` / `openid-client` 为 v2.0 用户中心(Casdoor)接入做准备

完整变更日志见 [release-notes.md](https://github.com/MatuX-ai/InsignForge/blob/main/release-notes.md)。
详细路线图见 [docs/扩展开发路线.md](https://github.com/MatuX-ai/InsignForge/blob/main/docs/%E6%89%A9%E5%B1%95%E5%BC%80%E5%8F%91%E8%B7%AF%E7%BA%BF.md)。
'@

$body | gh release create v1.3.0 `
  --repo MatuX-ai/InsignForge `
  --target main `
  --title 'InsightForge v1.3.0' `
  --notes - 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Warn 'gh release create 失败,可能未登录或 gh CLI 未安装。请手动创建:'
    Write-Host '  gh release create v1.3.0 --repo MatuX-ai/InsignForge --generate-notes' -ForegroundColor Yellow
} else {
    Done 'GitHub Release v1.3.0 created'
}

Write-Host ''
Write-Host '=== InsightForge v1.3.0 发布完成 ===' -ForegroundColor Green
Write-Host '  npm core     : https://www.npmjs.com/package/@insightforge/core/v/0.1.1'
Write-Host '  npm mcp-srv  : https://www.npmjs.com/package/@insightforge/mcp-server/v/0.1.1'
Write-Host '  GitHub       : https://github.com/MatuX-ai/InsignForge/releases/tag/v1.3.0'
