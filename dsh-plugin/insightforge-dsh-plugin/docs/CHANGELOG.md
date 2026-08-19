# 变更日志(Changelog)

所有显著变更都会记录于此。版本遵循 [SemVer 2.0.0](https://semver.org/)。

---

## [1.0.0] - 计划 2026-09

### 计划内容
- 服务接口稳定:`insightforge/demand` / `insightforge/report` / `insightforge/session` 三服务全部 production-ready
- 完整 API 文档(`docs/API.md`)
- 测试覆盖率 ≥ 70%
- 性能基准报告

### 已完成(对比 0.3.0)
- ✅ 4 个核心工具 + 3 个服务
- ✅ Cordis 完整适配
- ✅ 单元与集成测试覆盖
- ✅ Bundle 声明

---

## [0.3.0] - 计划 2026-08 + 4 周

### 新增
- Client 插件 `src/client.ts` 完整 UI 交互:
  - slash command `/research <idea>`
  - 消息输入按钮(快速调研 / 生成落地页 / 检索需求)
  - 报告预览面板(浏览器侧 DOM 渲染)
- esbuild IIFE 打包(`dist/client.js`,挂 `window.insightforgeClient`)

### 改进
- 报告渲染器 `formatReport` 升级为更友好的 Markdown 结构

---

## [0.2.0] - 计划 2026-08 + 2 周

### 新增
- `generate_landing` 工具:基于 idea + value_proposition 生成响应式 HTML
  - 支持 light / dark 主题
  - 支持 CTA、tagline、HTML 转义防 XSS
- `competitor_analysis` 工具:分析指定行业竞品
  - 返回 name / description / strengths / weaknesses / market_position
- 落地页 HTML 模板(`src/core/landing.ts`)

### 改进
- 聚合器 (`src/core/aggregator.ts`) 按 depth 自动调整搜索上限
- 三档深度参数完整覆盖 quick / standard / deep

---

## [0.1.0] - 2026-08 MVP

### 新增
- 包初始化:`package.json` 含 dsh.bundle / peerDependencies / exports["./client"]
- 目录结构:`src/{index,client,config,types,tools,services,core}`
- Cordis Host 插件:
  - 导出 `name` / `inject` / `Config` (schemastery) / `apply`
  - 注入 7 项配置(llmProvider / llmApiKey / searchProvider / searchEndpoint / dbPath / cacheEnabled / maxConcurrent)
- 2 个核心工具:
  - `market_research`:标准深度 < 3 分钟,缓存 LRU,支持并发
  - `search_demand`:SQLite FTS5 全文检索
- 核心协调器(`src/core/researcher.ts`):
  - 改编自 InsightForge 个人版 `MarketResearcher`
  - 集成关键词提取 → 多源聚合 → 报告生成三步骤
- 三档深度档位映射(quick=60s / standard=180s / deep=360s)
- LRU + TTL 缓存(`src/core/cache.ts`)
- 并发控制 Semaphore(`src/core/concurrency.ts`)
- 三个预留服务定义:`insightforge/demand` / `insightforge/report` / `insightforge/session`
- 搜索客户端:OpenSerp + Hacker News Algolia + Reddit JSON
- 兜底类型声明(`types/dsh.d.ts`):在 dsh 包尚未正式发布时,允许插件独立 typecheck
- 构建脚本(esbuild)、校验脚本、发布脚本
- 单元测试 + 集成测试(Vitest)
- 完整文档(API.md、CHANGELOG.md、cordis.yml.example、ANNOUNCEMENT.md、README.md)

### 技术栈
- Node.js >= 22
- TypeScript 5.6+(NodeNext 模块解析)
- better-sqlite3 11.x
- openai 4.x(DeepSeek / OpenAI / Ollama 兼容)
- zod 3.x
- pino 9.x

### 兼容性
- 与 InsightForge 个人版共享 `dbPath` 数据(FAQ Q4)
- 仅需 2 个外部 API Key:LLM + 搜索(FAQ Q2)

### 已知限制
- `@deepseek-ai/cordis` / `dsh-tools` / `schemastery` 包在 dsh v0.1 GA 前为 peerDependencies(opt-in)
  当前通过 `types/dsh.d.ts` 提供兜底类型声明
- Bundle patch 字段格式在 dsh v0.1 GA 后可能微调(以官方文档为准)

---

## [0.0.1] - 2026-08 草稿

需求文档编写阶段。

---

[Unreleased]: https://github.com/your-org/insightforge-dsh-plugin/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/insightforge-dsh-plugin/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/your-org/insightforge-dsh-plugin/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/your-org/insightforge-dsh-plugin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/your-org/insightforge-dsh-plugin/releases/tag/v0.1.0
[0.0.1]: https://github.com/your-org/insightforge-dsh-plugin/releases/tag/v0.0.1