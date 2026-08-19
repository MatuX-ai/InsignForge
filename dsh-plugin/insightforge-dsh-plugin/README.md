# InsightForge dsh Plugin

> 将 **InsightForge 市场调研能力**封装为 DeepSeek Harness (dsh) 插件。
> 4 个核心工具 + 3 个预留服务,支持 `quick / standard / deep` 三档深度。

[![npm version](https://img.shields.io/npm/v/insightforge-dsh-plugin.svg)](https://www.npmjs.com/package/insightforge-dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Bundle](https://img.shields.io/badge/dsh.bundle-cordis.patch.yml-blueviolet)](cordis.patch.yml)

---

## 📖 目录

- [项目简介](#项目简介)
- [核心能力](#核心能力)
- [安装](#安装)
- [快速上手](#快速上手)
- [配置说明](#配置说明)
- [客户端功能](#客户端功能)
- [使用示例](#使用示例)
- [缓存机制](#缓存机制)
- [错误处理与降级](#错误处理与降级)
- [架构概览](#架构概览)
- [开发与测试](#开发与测试)
- [发布流程](#发布流程)
- [FAQ](#faq)
- [许可证](#许可证)

---

## 项目简介

InsightForge dsh Plugin 是 [InsightForge 个人版](https://github.com/your-org/insignforge) 核心能力在
[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) 生态中的官方插件。

- **零外部服务**:核心算法全部打包进 npm 包,无需额外部署
- **共享需求库**:与 InsightForge 个人版共用 SQLite 数据库
- **三档深度**:quick / standard / deep 灵活平衡耗时与质量
- **Cordis 原生**:`ctx.effect()` + `ctx.onDispose()` 双保险清理
- **客户端 UI**:通过 esbuild IIFE 注入 dsh Web UI,提供 slash command、按钮与 DOM 渲染面板

适合场景:

- 产品经理:为新想法快速生成市场调研报告
- 创业者:提炼竞品画像、生成落地页
- 运营:基于 FTS5 在本地需求库检索用户痛点
- 其他 dsh 插件:通过 `insightforge/demand` 等服务复用调研能力

---

## 核心能力

### 🛠️ 工具(Tools)

| 工具名 | 必填参数 | 可选参数 | 典型耗时 | 输出 |
|--------|---------|---------|---------|------|
| `market_research` | `idea: string` | `depth?: 'quick' \| 'standard' \| 'deep'`(默认 `standard`) | quick=60s · standard=180s · deep=360s | 7 章节 `MarketReport`(见下) |
| `search_demand` | `query: string` | `limit?: number`(默认 20,最大 100) | <1s | `DemandHit[]`(FTS5 全文检索) |
| `generate_landing` | `idea`, `value_proposition` | `call_to_action`(默认"加入等待列表")、`theme?: 'light' \| 'dark'`(默认 light)、`tagline?` | <2s | `LandingPage`(`html` 单文件) |
| `competitor_analysis` | `domain: string` | `limit?: number`(默认 5,最大 20) | <90s | `CompetitorEntry[]` |

#### `market_research` 三档深度档位

| 档位 | 关键词数 | `maxTokens` | 搜索上限 | 预估耗时 | 温度 |
|------|---------|------------|---------|---------|------|
| `quick` | 3 | 1500 | 30 条 | 60s | 0.5 |
| `standard` | 5 | 4000 | 80 条 | 180s | 0.4 |
| `deep` | 8 | 8000 | 150 条 | 360s | 0.3 |

#### `market_research` 报告 7 章节

1. 执行摘要(summary)
2. 市场热度(market_heat: search_volume / discussion_count / trend / heat_score)
3. 竞品识别(competitors: name / description / url / strengths / weaknesses)
4. 用户痛点(pain_points)
5. 市场规模估算(market_size)
6. 风险(risks)
7. 机会(opportunities)

### 🔌 服务(Services,供其他 dsh 插件注入)

通过 `ctx.provide()` 注册到 Cordis 上下文,其他插件可在 `inject` 中声明依赖后通过 `ctx.inject<T>()` 获取。

| 服务 | 接口签名(节选) | 当前实现状态 |
|------|---------------|-------------|
| `insightforge/demand` | `search(query, limit?) → DemandHit[]` / `searchNeeds(query, limit?) → MarketNeed[]` / `stats() → DemandStats` | ✅ 全部完整 |
| `insightforge/report` | `generate(req) → ResearchResult` / `generateReportOnly(req) → MarketReport` / `peekCache(idea, depth?) → MarketReport \| null` | ✅ 全部完整 |
| `insightforge/session` | `create(idea, depth?) → ResearchSession` / `get(id) → ResearchSession \| undefined` / `list() → ResearchSession[]` / `delete(id) → boolean` | ⚠️ `list()` 返回 `[]`、`delete()` 返回 `false`(预留接口,v1.0.0 完整实现) |

> 完整 TypeScript 接口与字段定义见 [docs/API.md](docs/API.md)。

---

## 安装

```bash
# 首选 pnpm
pnpm add insightforge-dsh-plugin

# 或 npm / yarn
npm install insightforge-dsh-plugin
yarn add insightforge-dsh-plugin
```

**前置条件**

| 项 | 要求 | 备注 |
|----|------|------|
| Node.js | >= 22.0.0 | 引擎要求(见 `package.json`) |
| TypeScript | >= 5.6 | 仅当你消费本包类型时需要 |
| dsh | >= 0.1.0 | `@deepseek-ai/cordis` 等 |
| Python + C++ 工具链 | 编译 `better-sqlite3` 时需要 | 仅本地开发部署;预编译 binary 已涵盖多数场景 |

> 若 `@deepseek-ai/cordis` 等 peerDependencies 尚未发布到 npm,可临时跳过,
> 本包内置 `types/dsh.d.ts` 提供兜底类型声明,仍可独立 typecheck。

---

## 快速上手

### 1. 在 cordis.yml 中声明插件

完整示例见 [docs/cordis.yml.example](docs/cordis.yml.example)。最小化片段:

```yaml
plugins:
  insightforge-plugin:
    $: insightforge-dsh-plugin
    Config:
      llmProvider: deepseek
      llmApiKey: ${DEEPSEEK_API_KEY}
      searchEndpoint: http://localhost:18080
```

### 2. 启动 dsh web

```bash
pnpm dsh web --patch
```

dsh runtime 会自动读取 `cordis.patch.yml`,无需手工配置。

### 3. 在 dsh 会话中调用工具

```text
用户:请用 standard 档调研 "AI 会议记录助手"
dsh: 调用 market_research 工具... → 生成 7 章节报告
```

---

## 配置说明

7 项 schemastery 配置,加载时由 schemastery 自动校验(任何字段缺失/越界都会立即报错):

| 字段 | 类型 | 默认值 | 必填 | 校验 | 说明 |
|------|------|--------|------|------|------|
| `llmProvider` | `'deepseek' \| 'openai' \| 'ollama'` | `'deepseek'` | ✗ | enum | LLM 提供商 |
| `llmApiKey` | `string` | - | **✓** | 非空 | LLM API Key(ollama 可填占位符如 `"ollama"`) |
| `searchProvider` | `'openserp' \| 'serpapi'` | `'openserp'` | ✗ | enum | 搜索引擎 |
| `searchEndpoint` | `string` | `'http://localhost:8080'` | ✗ | 非空 | OpenSerp 服务地址 |
| `dbPath` | `string` | `'./data/insightforge.db'` | ✗ | 非空 | SQLite 数据库路径 |
| `cacheEnabled` | `boolean` | `true` | ✗ | - | 是否启用 LRU 缓存(默认 128 条 / 24h TTL) |
| `maxConcurrent` | `number` | `5` | ✗ | `1 ≤ n ≤ 32` | 最大并发调研数(NFR-06 信号量) |

**典型部署**

| 部署类型 | `searchEndpoint` | `searchProvider` | 备注 |
|---------|------------------|------------------|------|
| 本地 OpenSerp | `http://localhost:18080` | `openserp` | 默认,Docker 启动见 OpenSerp 文档 |
| 远程 OpenSerp | `http://openserp.internal:8080` | `openserp` | 集群部署 |
| SerpAPI 云端 | _(任意占位)_ | `serpapi` | 需额外 SERPAPI_KEY |

**与 InsightForge 个人版共享**:`dbPath` 默认 `./data/insightforge.db`,与个人版 `data/` 目录相对路径一致,自然共享同一份需求库(FAQ Q4)。

---

## 客户端功能

`src/client.ts` 经 esbuild 打包为 IIFE,挂在 `window.insightforgeClient`。浏览器侧 dsh Web UI 加载后,会向 shell 中注册以下扩展:

| 扩展类型 | 标识 | 行为 |
|---------|------|------|
| Slash command | `/research <idea>` | 命令面板中输入,触发 `market_research`(`depth: standard`) |
| Action 按钮 | `insightforge-quick-research` | 顶部工具栏按钮,弹窗输入 idea,调用 `market_research` |
| Action 按钮 | `insightforge-generate-landing` | 弹窗输入 idea,调用 `generate_landing`,用 Blob URL 在新窗口预览 HTML |
| Action 按钮 | `insightforge-search-demand` | 弹窗输入 query,调用 `search_demand`,在控制台打印命中 |
| 报告预览面板 | DOM 元素 `#insightforge-report-preview` | 右下角浮窗,渲染 7 章节报告 + 关闭按钮 |

> **设计差异说明**:文档 4.4 节示例使用 `ctx.shell.overlay.register`,本实现基于 dsh v0.1 alpha 的实际 API 改用 `ctx.shell.command.register` + `ctx.shell.action.register` 组合,可同时支持 slash 命令、按钮与 DOM 面板。等 dsh v0.1 GA 后如有差异,以官方文档为准。

`Client → Host` 通信通过 `globalThis.__dshTools__.invoke()` 转发;若 dsh 未注入(独立测试场景),自动降级为 console.log,不抛错。

---

## 使用示例

### 示例 1:基础调研

```typescript
// dsh 会话内
await ctx.tools.invoke('market_research', {
  idea: 'AI 会议记录助手',
  depth: 'standard',
});
```

### 示例 2:并发调研(信号量自动限流)

```typescript
// 同时调研多个想法,maxConcurrent=5 时最多 5 个并发,其余排队
const ideas = ['AI 笔记', 'AI 周报', 'AI 客户洞察'];
const reports = await Promise.all(
  ideas.map((idea) =>
    ctx.tools.invoke('market_research', { idea, depth: 'quick' }),
  ),
);
```

### 示例 3:落地页生成 + 浏览器预览

```typescript
const page = await ctx.tools.invoke('generate_landing', {
  idea: 'AI Meeting Notes',
  value_proposition: '让会议纪要 10 倍速产出',
  call_to_action: '立即加入等待列表',
  theme: 'dark',
});
console.log(page.html); // 单文件 HTML 字符串,可直接 fs.writeFile
```

### 示例 4:在另一个插件中消费 InsightForge 服务

```typescript
export const name = 'my-plugin';
export const inject = ['insightforge/demand', 'insightforge/report'];

export function apply(ctx, config) {
  const demand = ctx.inject<DemandService>('insightforge/demand');
  const report = ctx.inject<ReportService>('insightforge/report');

  // 查需求
  const hits = demand.search('AI meeting notes', 10);
  console.log(`找到 ${hits.length} 条需求,平均互动 ${demand.stats().avgEngagement}`);

  // 直接生成报告(跳过工具调用层,适合后端批处理)
  const result = await report.generate({ idea: 'AI 客户洞察', depth: 'deep' });
}
```

### 示例 5:复用缓存

```typescript
const report = ctx.inject<ReportService>('insightforge/report');
const cached = report.peekCache('AI 会议记录助手', 'standard');
if (cached) {
  console.log('命中缓存,直接返回');
}
```

### 示例 6:在浏览器侧直接调用工具(Client 端)

```javascript
// 浏览器 console(由 dsh 自动注入)
const { insightforgeClient } = window;
// 触发一次快速调研
await window.__dshTools__.invoke('market_research', {
  idea: 'AI 会议记录助手',
  depth: 'quick',
});
```

---

## 缓存机制

`config.cacheEnabled = true` 时,`InsightForgeCore` 内部维护一个 LRU 缓存:

| 维度 | 数值 | 说明 |
|------|------|------|
| 容量 | 128 条 | 超过则按 LRU 淘汰最旧条目 |
| TTL | 24 小时 | 过期即视为未命中 |
| Key | `hash(idea + depth + day)` | 同 idea 同 depth 同一天复用结果 |
| 关闭方式 | `cacheEnabled: false` 或 `req.noCache: true` | 单次调用绕过缓存 |

**收益**:同一 idea + depth 在 24h 内的二次调用**直接返回缓存**,节省 LLM 调用费 + 搜索 API 费用。

---

## 错误处理与降级

| 异常场景 | 降级行为 |
|---------|---------|
| `idea` 为空 / < 3 字符 | 工具层抛错(参数校验,不上抛 LLM) |
| LLM 调用超时 / 网络异常 | 关键词提取阶段 fallback 为启发式分词;报告生成阶段返回错误并在日志记录 |
| LLM 返回的 JSON 校验失败 | `safeParse` 失败时 fallback(关键词)或抛错(报告) |
| OpenSerp 调用失败 | 跳过该数据源,继续采集其他源(`Promise.allSettled` 优雅降级) |
| SQLite FTS5 索引不可用 | 自动降级为 LIKE 查询,返回空数组或部分匹配 |
| 竞品分析 LLM 输出非数组 | 返回空数组(不抛错),日志记录 |
| 重复 dispose() | `disposed` 标志短路,幂等安全 |
| 单元测试中无 better-sqlite3 原生绑定 | `hasSqliteBindings()` 检测 → 自动 skip 并打印警告 |

所有错误都会以 pino 结构化日志输出,字段含 `err` / `projectId` / `depth` / `provider` 等,便于排查。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                       dsh runtime (Cordis)                  │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │  Host Plugin (Node) │    │  Client Plugin (Browser) │   │
│  │  src/index.ts       │    │  src/client.ts           │   │
│  │  · 4 工具注册       │    │  · /research slash cmd   │   │
│  │  · 3 服务 provide   │    │  · 3 个工具栏按钮        │   │
│  │  · dispose 双保险   │    │  · 报告 DOM 浮窗         │   │
│  └──────────┬───────────┘    │  · Blob 预览落地页       │   │
│             │                └──────────────────────────┘   │
│  ┌──────────▼──────────────────────────────────────────┐    │
│  │  InsightForgeCore (src/core/researcher.ts)          │    │
│  │  Semaphore → 关键词提取 → 多源聚合 → 报告生成       │    │
│  │  + LRU 缓存 + sessions Map + dispose()              │    │
│  └──────────┬──────────────────────────────────────────┘    │
│             │                                                │
│  ┌──────────▼───────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  LLM 客户端       │  │  搜索引擎     │  │  SQLite      │  │
│  │  deepseek/openai │  │  OpenSerp    │  │  WAL 模式    │  │
│  │  /ollama         │  │  HN Algolia  │  │  FTS5 索引   │  │
│  │  OpenAI 兼容协议  │  │  Reddit JSON │  │              │  │
│  └──────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
insightforge-dsh-plugin/
├── package.json                  # dsh.bundle.patch + peerDependencies + exports["./client"]
├── cordis.patch.yml              # Bundle 层 patch(自动被 dsh runtime 读取)
├── tsconfig.json                 # ESM + NodeNext + Node 22+
├── vitest.config.ts              # peer deps stub 别名(dsh GA 前)
├── LICENSE (MIT)
├── README.md                     # 本文件
├── src/
│   ├── index.ts                  # Host 入口:name/inject/Config/apply + dispose
│   ├── client.ts                 # Client 入口:slash + 按钮 + DOM 浮窗
│   ├── config.ts                 # schemastery 7 项 schema
│   ├── config-types.ts           # 真实 Config 类型(独立维护,避免 any)
│   ├── types.ts                  # MarketReport / MarketNeed / ResearchSession 等
│   ├── logger.ts                 # pino + pino-pretty 优雅降级
│   ├── tools/                    # 4 个 defineTool 工具
│   │   ├── market-research.ts    # 7 章节报告 + formatReport Markdown 渲染
│   │   ├── search-demand.ts      # FTS5 + LIKE 双层降级
│   │   ├── generate-landing.ts   # HTML 模板(light/dark 主题 + XSS 转义)
│   │   └── competitor.ts         # 复用 extractKeywords + aggregate + LLM 抽取
│   ├── services/                 # 3 个预留服务
│   │   ├── demand-service.ts     # search / searchNeeds / stats
│   │   ├── report-service.ts     # generate / generateReportOnly / peekCache
│   │   └── session-service.ts    # create / get / list(预留)/ delete(预留)
│   └── core/                     # 核心算法 + 数据访问
│       ├── researcher.ts         # InsightForgeCore 协调器(438 行)
│       ├── aggregator.ts         # 多源采集 + 去重 + 持久化
│       ├── llm.ts                # chatJson / chatComplete(OpenAI 兼容)
│       ├── db.ts + db-schema.ts  # SQLite 封装 + WAL + FTS5
│       ├── landing.ts            # 落地页 HTML 生成器
│       ├── cache.ts              # SimpleLRUCache + reportCacheKey
│       ├── concurrency.ts        # Semaphore(NFR-06)
│       ├── open-serp.ts          # OpenSerp HTTP 客户端
│       ├── hacker-news.ts        # HN Algolia 客户端
│       ├── reddit.ts             # Reddit JSON 客户端
│       ├── prompts/              # KEYWORD_EXTRACTION_SYSTEM / REPORT_GENERATION_SYSTEM
│       └── schemas/report.ts     # Zod 校验(LLM 输出)
├── types/
│   └── dsh.d.ts                  # @deepseek-ai/* 兜底类型声明
├── tests/
│   ├── tools.test.ts             # 18 个单元测试
│   ├── integration.test.ts       # 9 个集成测试
│   ├── fixtures/sample-report.json
│   └── stubs/                    # peer deps stub(cordis / dsh-tools / schemastery)
├── scripts/
│   ├── build.mjs                 # esbuild 打包 Host + Client
│   ├── release.mjs               # 交互式版本 bump + 打印发布命令
│   ├── verify-bundle.mjs         # bundle 校验(需 dist 已生成)
│   └── verify-structure.mjs      # 离线结构校验(无需依赖)
└── docs/
    ├── API.md                    # 完整接口文档
    ├── CHANGELOG.md              # v0.0.1 → v1.0.0
    ├── cordis.yml.example        # 完整 cordis 配置示例
    └── ANNOUNCEMENT.md           # 社区公告草稿
```

---

## 开发与测试

```bash
# 1. 安装依赖(需 Python + C++ 工具链以编译 better-sqlite3)
pnpm install

# 2. 类型检查
pnpm typecheck

# 3. 跑测试(Vitest,27 个用例)
pnpm test

# 4. 打包(产物输出到 dist/)
pnpm build          # host + client
pnpm build:host     # 仅 host(ESM)
pnpm build:client   # 仅 client(IIFE,挂 window.insightforgeClient)

# 5. 校验 bundle 声明
pnpm verify

# 6. 离线结构校验(无需 dist 与依赖,适合 pre-commit hook)
node scripts/verify-structure.mjs
```

### 测试覆盖(共 27 用例)

| 文件 | 数量 | 覆盖范围 |
|------|------|---------|
| `tests/tools.test.ts` | 18 | `SimpleLRUCache`(4)/ `Semaphore`(3)/ `formatReport` 7 章节(2)/ `generateLanding`(4)/ 参数校验(2)/ `Config` 默认值(2)/ `search_demand` limit clamp(1) |
| `tests/integration.test.ts` | 9 | `cordis.patch.yml` 存在(1)/ `package.json` 字段(5)/ `apply()` 注册 4 工具 + 3 服务 + dispose 幂等(1)/ Client IIFE 形态校验(2) |

> **注**:`apply()` 集成测试在 better-sqlite3 原生绑定不可用的环境(如无 Python 的开发机)会跳过,其余测试均完全离线。

---

## 发布流程

发布脚本会引导你完成版本号选择、校验、构建,并输出 `npm publish` / `git push` 命令(由用户在交互终端执行):

```bash
pnpm release
```

交互流程:

1. 选择 bump 类型(major / minor / patch)
2. 自动更新 `package.json` version + 生成 `git tag`
3. 跑 `pnpm test` + `pnpm build`
4. 跑 `pnpm verify`(校验 bundle)
5. 打印执行命令提示:
   - `npm login`(若未登录)
   - `npm publish --access public`
   - `git push origin main --tags`
   - 在 dsh 社区粘贴 `docs/ANNOUNCEMENT.md`

> 真实 npm / git push 由用户在交互终端执行,不在脚本范围内。

---

## FAQ

**Q1:是否需要独立部署后端?**
A:不需要。整个核心逻辑打包进 npm 包,只有 SQLite 文件 + 两个外部 API Key(LLM + 搜索)。

**Q2:需要哪些 API Key?**
A:仅需 LLM(DeepSeek/OpenAI/Ollama) + 搜索(默认本地 OpenSerp,无需 Key)。

**Q3:与 InsightForge 个人版的关系?**
A:本插件的 `src/core/*` 与个人版 `backend/src/agents`、`MarketNeedService`、`Aggregator`、`LLMClient` 保持同步,prompt / schema 字符级一致。

**Q4:能否复用个人版的需求库?**
A:可以。`dbPath` 默认 `./data/insightforge.db`,与个人版默认数据目录相对路径一致,自然共享。

**Q5:`@deepseek-ai/cordis` 等包还未发布怎么办?**
A:`peerDependencies` 声明为 `optional`,本包内置 `types/dsh.d.ts` 提供兜底类型声明,可独立 typecheck。

**Q6:能离线使用吗?**
A:部分功能可以。`search_demand` 仅依赖本地 SQLite,无需联网;`market_research` 仍需 LLM + 搜索 API。

**Q7:如何扩展自定义深度档位?**
A:暂未提供扩展点。可 fork 后修改 `src/core/researcher.ts` 中的 `DEPTH_PROFILES`。

**Q8:缓存什么时候生效?**
A:默认开启(`cacheEnabled: true`),key = `hash(idea + depth + day)`,24h TTL。同 idea 同 depth 同一天二次调用直接返回缓存。

**Q9:OpenSerp / Reddit 不可用会怎样?**
A:每个数据源独立超时(默认 20s),`Promise.allSettled` 优雅降级,只要有一个源成功即可继续生成报告。

**Q10:`insightforge/session` 的 list/delete 为何返回空?**
A:v0.x 阶段只保证 `create` / `get` 完整,`list()` / `delete()` 是为 v1.0.0 预留的接口契约(返回空数组 / false)。升级时其它插件无需修改调用代码。

**Q11:为什么我的测试报"better-sqlite3 bindings not found"?**
A:`better-sqlite3` 是原生模块,需 Python + C++ 工具链编译,或下载预编译二进制。在无编译环境的开发机上,`integration.test.ts` 会自动 skip 相关用例,不影响其它测试。

---

## 许可证

[MIT](LICENSE) © InsightForge Contributors