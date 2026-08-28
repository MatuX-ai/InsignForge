# scripts/release-github.ps1
# Publish InsightForge dsh Plugin v0.1.0 to GitHub Releases
# Usage (run in an interactive PowerShell terminal):
#   cd e:\Dady_project\InsignForge
#   powershell -ExecutionPolicy Bypass -File .\scripts\release-github.ps1
#
# You can also provide credentials via environment variables:
#   $env:GH_TOKEN = 'ghp_xxx'
#   powershell -ExecutionPolicy Bypass -File .\scripts\release-github.ps1

$ErrorActionPreference = 'Stop'

# ---------- Configuration ----------
$repo = 'MatuX-ai/InsignForge'
$tag = 'v0.1.0'
$commit = '27050afeb14d25090f3f9d4313ecd0d49c4748f8'

# ---------- Credentials ----------
$token = $env:GH_TOKEN
if (-not $token) {
    $secure = Read-Host -Prompt 'GitHub PAT (scope: public_repo or repo)' -AsSecureString
    if (-not $secure) { Write-Host 'EMPTY TOKEN, ABORT' -ForegroundColor Red; exit 1 }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
}

$headers = @{
    'Authorization'         = "token $token"
    'Accept'                = 'application/vnd.github+json'
    'User-Agent'            = 'release-github.ps1'
    'X-GitHub-Api-Version'  = '2022-11-28'
}

# ---------- Idempotency check ----------
Write-Host ''
Write-Host ">>> GET /repos/$repo/releases/tags/$tag" -ForegroundColor Cyan
try {
    $existing = Invoke-RestMethod -Method GET `
        -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" `
        -Headers $headers `
        -TimeoutSec 30
    Write-Host "Release for $tag already exists:" -ForegroundColor Yellow
    Write-Host ("  ID:  " + $existing.id)
    Write-Host ("  URL: " + $existing.html_url)
    Write-Host ''
    $ans = Read-Host -Prompt 'Delete existing release and recreate? (y/N)'
    if ($ans -notin @('y', 'Y', 'yes', 'YES')) {
        Write-Host 'ABORTED' -ForegroundColor Yellow
        exit 0
    }
    Write-Host ">>> DELETE /repos/$repo/releases/$($existing.id)" -ForegroundColor Cyan
    Invoke-RestMethod -Method DELETE `
        -Uri "https://api.github.com/repos/$repo/releases/$($existing.id)" `
        -Headers $headers `
        -TimeoutSec 30 | Out-Null
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ne 404) {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) { Write-Host "DETAILS: $($_.ErrorDetails.Message)" -ForegroundColor Red }
        exit 1
    }
    Write-Host 'No existing release, creating new' -ForegroundColor Green
}

# ---------- Create release ----------
$body = @"
## InsightForge dsh Plugin v0.1.0

首个公开版本 —— DeepSeek Harness (`dsh`) 生态官方插件。

### 核心能力

- **4 个工具**:`market_research` / `search_demand` / `generate_landing` / `competitor_analysis`
- **3 个服务**:`insightforge/demand` / `insightforge/report` / `insightforge/session`
- **三档深度**:`quick` (60s) / `standard` (180s) / `deep` (360s)
- **客户端**:1 个 `/research` slash + 3 个 action 按钮 + DOM 报告浮窗 + Blob URL 落地页预览

### 安装

````bash
pnpm add insightforge-dsh-plugin
````

### 文档

- [README](https://github.com/MatuX-ai/InsignForge/blob/main/dsh-plugin/insightforge-dsh-plugin/README.md)
- [API 文档](https://github.com/MatuX-ai/InsignForge/blob/main/dsh-plugin/insightforge-dsh-plugin/docs/API.md)
- [更新日志](https://github.com/MatuX-ai/InsignForge/blob/main/dsh-plugin/insightforge-dsh-plugin/docs/CHANGELOG.md)

### 状态

- 27/27 测试通过(`tests/tools.test.ts` 18 个 + `tests/integration.test.ts` 9 个)
- Bundle 校验 0 错误 0 警告
- 依赖 `better-sqlite3` 需 Python + C++ 工具链(预编译 binary 覆盖主流平台)

### 文件结构

- `dsh-plugin/insightforge-dsh-plugin/` —— 完整 npm 包(含 `src/`、`tests/`、`docs/`、`scripts/`、`cordis.patch.yml`)
- `dsh-plugin/insightforge-dsh-plugin/dist/index.js` —— Host 入口(ESM, ~51KB)
- `dsh-plugin/insightforge-dsh-plugin/dist/client.js` —— Client 入口(IIFE, ~6KB)
"@

$payload = @{
    tag_name         = $tag
    target_commitish = $commit
    name             = 'InsightForge dsh Plugin v0.1.0'
    body             = $body
    draft            = $false
    prerelease       = $false
} | ConvertTo-Json -Depth 10

Write-Host ''
Write-Host ">>> POST /repos/$repo/releases" -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Method POST `
        -Uri "https://api.github.com/repos/$repo/releases" `
        -Headers $headers `
        -ContentType 'application/json' `
        -Body $payload `
        -TimeoutSec 60
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host "DETAILS: $($_.ErrorDetails.Message)" -ForegroundColor Red }
    exit 1
}

Write-Host ''
Write-Host '=== Release Created ===' -ForegroundColor Green
Write-Host ('ID:     ' + $response.id)
Write-Host ('Tag:    ' + $response.tag_name)
Write-Host ('Name:   ' + $response.name)
Write-Host ('URL:    ' + $response.html_url)
Write-Host ('Upload: ' + $response.upload_url)
Write-Host ''
Write-Host 'GitHub Release published successfully.' -ForegroundColor Green