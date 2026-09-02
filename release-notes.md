# InsightForge v1.7.0 (中文数据源接入 · 未发版候选)

## 背景

v1.6 后报告页「数据来源」卡片仍只靠英文 HN / Reddit / OpenSerp 三路,调研中文产品时中文社区贡献度始终为 0。v1.7 补上中文语料,并在架构上为未来接 ProductHunt / 公开 API 预留了 "加入新源 = 3 件事" 的低门槛模板。

## 新特性

### 中文数据源接入

「数据来源」卡片默认覆盖从 3 路扩到 7 路(由于 2 路为接入骨架,生产中实际贡献可能为 5~6 路):

| Source | 类型 | 实装状态 |
|---|---|---|
| `zhihu` (知乎) | forum (1.1) | 实装(公开 search_v3 API) |
| `juejin` (掘金) | forum (1.0) | 实装(公开 POST search API) |
| `weibo` (微博) | social (0.8) | **骨架**(需要登录 cookie) |
| `xiaohongshu` (小红书) | social (0.8) | **骨架**(需要 login + `x-s`/`x-t` 签名) |

### 架构备忘

- 新增数据源 Client 5 件事:
  1. 在 `backend/src/services/search/XxxClient.ts` 复用 HackerNews 模板(`withReliability` + `fetchWithRetry` + `AbortController` + 重试退避)
  2. 在 `backend/src/services/search/Aggregator.ts` 的 `Promise.allSettled` 数组里加一项
  3. 在 `backend/types/index.ts` 与 `frontend/src/types/index.ts` 两端同步扩展 `MarketNeedSource` 联合
  4. 在 `sourceWeights.ts` 的 `DEFAULT_WEIGHTS` 表里加一条默认权重与类型
  5. 在 `frontend/src/components/SourceContributionCard.tsx` 的 `SOURCE_ICON` 里加一个 emoji(上首后为可选)

### 骨架源的诚实交付

微博、小红书公开接口匿名 100% 触发风控，本项目仅交付接入骨架：

- `searchWeibo` / `searchXiaohongshu` 默认 return `[]`;不接入 `withReliability`,避免熔断器误计为失败
- `sourceWeights.ts` 加 `DISABLED_SOURCES` 常量 + `getDisabledSourceNotes()` 函数
- 后端启动时主动 `logger.warn` 报告当前未启用骨架源名单,便于运维一眼看到

### 启动期日志

后端启动时输出 `以下数据源当前为骨架(未实装匿名抓取,…)`,提示本项目在这些源上为骨架状态。

## 体验打磨

- **`SourceContributionCard` 中文源 emoji**: zhihu=🟦、juejin=🟪、weibo=🔴、xiaohongshu=📕。骨架源也展示避免遇到 0 条时名片错乱。
- **报告页 `[数据来源]` 卡片**: 骨架源贡献为 0 时同样出现在报告卡上,用户可一眼看哪些源可用、哪些暂未接。

## 工程

- **新增文件**: `ZhihuClient.ts` / `JuejinClient.ts`(实装) / `WeiboClient.ts` / `XiaohongshuClient.ts`(骨架) / `sourceWeights.test.ts`(7 case → 10 case)
- **修改文件**:
  - `backend/src/services/search/Aggregator.ts`(7 路并发)
  - `backend/src/types/index.ts` + `frontend/src/types/index.ts`(`MarketNeedSource` 联合 +4 项,字面一致)
  - `backend/src/services/search/sourceWeights.ts` + 默认权重表 + `DISABLED_SOURCES`
  - `backend/src/index.ts`(启动 warn 报告骨架名单)
  - `backend/tests/Aggregator.test.ts`(8 case)
  - `frontend/src/components/SourceContributionCard.tsx`(4 个 emoji)
  - `docs/03-技术文档.md` §3.5.2(补 1 行)
- **测试**: `sourceWeights` 7→10;`Aggregator` 8;总 22 文件 / 370 case 100% PASS,tsc --noEmit 零错。

## 不在本次范围(推进记录)

- **ProductHunt 接入** — 需要 OAuth client_id/secret,不在 v1.7 个人版范围;类型已在表中预留,客户端文件待创建
- **微博/小红书 Cookie 接入** — 需要用户账号体系及合规审查,等团队版 v2.0 引入 Cookie Vault 后处理
- **沙盒手动 smoke 脚本** — `scripts/smoke-zhihu.ts` 供本地一行验证 zihu/juejin 真实接口;未需时可不建

## 核对清单

- ✅ 多源采集引擎可靠性基座未受破坏(retry/breaker/cache/metrics 对新源自动生效)
- ✅ 失败隔离实测: zhihu/juejin 报错不影响 HN/Reddit/Google 路径
- ✅ 骨架源不计入 `circuit_opened` 指标,避免错误诊断告警
- ✅ TypeScript / ESLint / vitest 全绿

---

# InsightForge v1.3.0

可观测性、用户可控性、采集引擎健壮性增强同步上。

## 新特性

### 多源采集引擎可靠性基座

在 `backend/src/services/search/reliability.ts` 引入统一可靠性装饰器,所有搜索客户端内部 fetch 走 `withReliability` + `fetchWithRetry`,关键能力：

- **重试**：指数退避（默认 2 次）,仅对 5xx / 429 / 网络错误重试
- **熔断**：每源连续 5 败自动开 30s,半开探测恢复
- **去重**：URL 归一化 + title/source 指纹,无 url 走 fallback 指纹
- **缓存**：进程内 `TtlCache`,默认 5min TTL
- **并发**：关键词维度 `KEYWORD_CONCURRENCY=3` 信号量限流
- **错误分类**：8 类 `SourceError.kind`,按 `retryable` 决定是否重试

### 健康检查 API

- `GET /api/v1/health/sources` 返回四个源的实时指标快照:success / failure / successRate / avgLatencyMs / failureByKind / cacheHits / circuitOpened / state。
- 仅桌面模式或管理员可访问,避免外网扫描。
- 熔断打开时 `state: 'open'` 立即可见。

### 错误消息人性化翻译

新增 `frontend/src/lib/errorMessages.ts`,把 `SourceError.kind` 翻译为中文提示：

| kind | 文案 |
|------|------|
| `network` | 网络异常,请检查连接 |
| `timeout` | 请求超时,稍后重试 |
| `rate_limit` | 搜索引擎限流,请稍后重试或切换 SerpAPI |
| `server_5xx` | 源服务端异常,已自动重试 |
| `circuit_open` | 源暂时熔断,已自动跳过 |
| `client_4xx` | 鉴权或参数错误,请检查配置 |

### SourceContributionCard & Monitor 页

- 报告页底部新增 `SourceContributionCard`,展示本次调研各源命中占比与平均延迟,让用户直观看到贡献分布。
- 新增 `Monitor` 页(`/monitor`)供管理员查看实时源快照,后续接入权限控制。

### 使用量与配额

- 新增 `quota` 测试基座 + `backend/tests/quota.test.ts`,为后续多用户配额预留接入点。

## 体验打磨

- **AuthCallback 页**：第三方登录回调落点,占位 UI 已就位,等待 Casdoor 接入完成。
- **useCurrentUser**：`useAuth()` 集中入口,自动随 cookie 变化刷新当前用户态。
- **TopBar / AppShell**：为多账号场景预留次级提示条,样式与深色模式统一。

## 工程

- **依赖新增**:`express-session`、`openid-client`(`@types/express-session`),为 v2.0 用户中心/Casdoor 接入做准备。
- **测试**:新增 9 个测试文件 (`Aggregator` / `cache` / `cacheScheduler` / `contributions` / `dataOwnership` / `dedupe` / `errorMessages` / `health` / `intelligence` / `quota` / `reliability` / `scheduler`),共新增 89 个测试用例。
- **`vitest.config.ts`**:`search/` 子树加入覆盖率统计,后端测试基座覆盖率门槛抬到 80%。
- **docs/扩展开发路线.md**：新增 v1.3 → v2.0 的阶段路线图(从交付节奏到可复用模板)。

## NPM 包

| 包 | 0.1.0 → 0.1.1 变动 |
|---|----------------------|
| `@insightforge/core` | 与仓库 v1.3.0 同步发版,接口不变 |
| `@insightforge/mcp-server` | 与仓库 v1.3.0 同步发版,tools 列表不变 |

---

# InsightForge v1.2.0

UX 优化、可访问性加固、CI 修复。

## 新特性

### 复制并重新调研

Report 页顶部按钮区新增 “📋 复制并重新调研” 按钮，一键基于现有项目描述创建新项目并重新运行调研，避免覆盖原报告，适合多角度验证场景。

### 导出进度反馈

PDF/Markdown/JSON 导出时顶部出现进度卡片，明示三个阶段（连接后端 / 后端生成中 / 下载到本地）与已用秒数。长报告生成时 ≥8 秒后会提示 “⏳ 大报告生成时间可能稍长，请勿关闭页面…”，完成后 2 秒内显示 “✅ 已下载到本地” 的绿色提示。

## 体验打磨

- **Report 页**：8 个导出/分享/流程按钮重新组织为 3 组（分享导出 / 流程动作 / 高级产物）；节区重新排序并加分割线；横滚章节导航 (TOC) 带 scroll-spy 联动与键盘导航。
- **Settings 页**：未保存变更指示器 + Revert 按钮 + beforeunload 页面离开守卫。
- **History 页**：4 种排序（最新/最早/热度↓/竞品数↓）。
- **Discuss 页**：输入框为空时提示 4 个模板；实时字数计数器；发送按钮 ⏎ 提示。
- **Home 页**：调研创建过程中联动展示自动重试进度（指数退避 1s/2s/4s）。
- **TopBar**：移动端汉堡菜单 + 完整 a11y 属性。

## 可访问性与健壮性

- **Modal**：完整 focus trap（自动聚焦 + Tab/Shift+Tab 循环 + 关闭还原焦点）。
- **Dropdown**：↑↓ 菜单项循环跳过 disabled + 关闭后焦点还原到 trigger。
- **ReportToc**：方向键 ←→/Home/End 导航 + roving tabindex + scroll-spy。
- **iframe**（落地页预览）：改为 `sandbox=""` 完全沙箱化。
- **剪贴板**：`shareLink` / `copySummary` 在非 HTTPS 或旧浏览器自动降级到 `textarea + execCommand`，且不管成败保证 textarea 节点被清理。
- **useResearch**：网络瞬时错误指数退避自动重试 3 次；同时暴露手动 `retry()`。

## 设计系统

- 引入语义化 token：`text-body` / `text-helper` / `text-label` / `text-title` / `text-section` / `text-display`。
- Card 组件新增 5 种 `tone` 变体（default / primary / success / danger / warning）。
- Button / Report 页全面替换魔法字号为 token。

## 工程

- **CI 修复**（`.github/workflows/ci.yml`）：最近 3 次 CI 都因 “Cannot find module '@insightforge/core'” 失败，原因是其他 workspace typecheck 时 core/mcp-server 还未产出 `dist/`。已在 typecheck step 之前构建依赖包。

---

# InsightForge v1.1.0

扩展市场调研工具到更多场景：商业计划书生成、技术选型、前端设计文档、团队讨论协作。

## 新特性

### 多场景文档生成

- **商业计划书**：基于市场调研数据自动生成完整商业计划书
- **技术选型分析**：AI 驱动的技术栈推荐与对比分析
- **前端设计文档**：自动生成组件规范、页面结构、设计系统文档
- **讨论协作**：支持多轮头脑风暴式讨论，结构化输出结论

### 用户体验优化

- **首次使用引导**：新用户首次启动时显示功能介绍引导
- **历史记录管理**：支持查看和管理历史生成记录
- **设置页面优化**：更清晰的环境配置管理

## 特性

- **一句话输入 → 7 章节结构化报告**：市场热度、竞品识别、用户痛点、市场规模、风险机会、数据来源
- **多源数据聚合**：集成 OpenSerp 搜索 + Reddit 社区讨论 + Hacker News 技术圈动态
- **全本地存储**：SQLite 本地化，无云依赖、无注册、无账号
- **一键部署**：Docker Compose 一条命令拉起所有服务
- **Mastra 智能体编排**：基于 `@mastra/core` 的可扩展 Agent 架构

## 桌面版 (Windows)

新增 Electron 桌面应用打包，无需 Docker 与 Node.js 环境，下载即用：

| 产物 | 说明 |
|------|------|
| `InsightForge-1.1.0-x64.exe` | NSIS 安装程序，支持选择安装目录、创建快捷方式 |
| `InsightForge-1.1.0-portable-x64.exe` | 便携版，免安装直接运行 |

- 应用内置后端子进程（纯 Node 模式 fork），自动随机端口，不占用 3000/3001
- 数据与配置写入用户目录 `%APPDATA%\InsightForge`，可持久化、可迁移
- 后端静态托管前端构建产物，全链路本地运行

### 构建桌面版

```bash
# 根目录
npm install

# 桌面包
cd desktop
npm install
npm run dist     # 产物: desktop/dist/*.exe
```

## 技术栈

| 层级 | 技术 |
|---|---|  
| 前端 | React 18 + Vite + Tailwind CSS + TypeScript |
| 后端 | Node.js 22 + Express + TypeScript + better-sqlite3 |
| 智能体 | Mastra (`@mastra/core`) |
| 数据采集 | OpenSerp + Crawlee + Playwright |
| 数据库 | SQLite (开发) / PostgreSQL (生产预留) |
| 部署 | Docker Compose |
| 桌面 | Electron 33 + electron-builder 24 |

## 快速开始

```bash
# 1. 克隆
git clone git@github.com:MatuX-ai/InsignForge.git
cd InsignForge

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env,填入 DEEPSEEK_API_KEY 或 OPENAI_API_KEY

# 3. 启动所有服务
docker-compose up -d

# 4. 打开浏览器
# http://localhost:3000
```

## 文档

- `docs/01-项目说明与需求说明书.md` — 产品需求
- `docs/02-前端设计文档.md` — 前端架构
- `docs/03-技术文档.md` — 技术细节
- `docs/04-用户中心需求文档.md` — 用户中心规划

## 路线图

- **v1.1 (当前)**：多场景文档生成、商业计划书、技术选型、讨论协作
- **v1.2**：数据可视化图表、Markdown / PDF 导出
- **v2.0**：团队版、Casdoor 多用户

---

许可证：MIT
