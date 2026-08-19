# InsightForge —— DeepSeek Harness 插件需求文档

**版本**：v1.0  
**最后更新**：2026年8月  
**文档状态**：正式发布  


## 一、文档概述

### 1.1 文档目的

本文档定义将 **InsightForge** 封装为 **DeepSeek Harness (dsh) 插件** 的功能需求、技术方案和交付标准。

### 1.2 背景

DeepSeek Harness 于 2026 年 8 月 13 日发布 v0.1 开发者预览版，采用 MIT 开源协议，提出 **"一切皆插件"** 的架构理念——模型适配器、工具注册表、会话日志、甚至 Agent Loop 本身均可插拔替换。发布 12 小时内 GitHub Star 突破 5 万，24 小时内社区涌现 288 个带 `dsh-plugin` 标签的插件仓库。

将 InsightForge 封装为 dsh 插件，可实现：

- **直接触达 dsh 生态**：借助 dsh 庞大的开发者与用户社区降低获客门槛
- **验证架构价值**：证明 InsightForge 作为"可组合能力单元"的复用性
- **双向赋能**：为 dsh 生态提供专业的市场分析能力，为 InsightForge 引入 dsh 的工具链和会话管理能力

### 1.3 阅读指南

| 读者角色 | 建议阅读章节 |
|----------|-------------|
| 插件开发者 | 二、插件设计；三、功能需求；四、技术方案 |
| 架构师 | 二.1 核心理念；五、Cordis 架构适配 |
| 产品经理 | 二、插件设计；六、交付物与发布 |


## 二、插件设计

### 2.1 核心理念

**InsightForge 插件** 将 InsightForge 的市场调研能力，封装为一个或多个 dsh 可调用的工具（Tools）和服务（Services）。用户无需部署完整的 InsightForge 应用，通过 dsh 即可调用其核心能力。

> 类比：InsightForge 是一间"调研工厂"，dsh 插件是开在工厂里的"窗口"——用户通过窗口提交需求，工厂在后台运转，最终从窗口交付报告。

### 2.2 插件形态

InsightForge 插件将以 **一个 npm 包** 的形式发布，包含：

| 组件 | 说明 |
|------|------|
| **Host 插件** | 运行在 dsh 服务端，注册核心工具和服务 |
| **Client 插件** | 运行在 dsh Web UI 前端，提供可视化交互 |
| **Bundle 声明** | 通过 `dsh.bundle` 字段声明插件组合包 |

这种架构参考了 dsh 生态中成熟的插件工程模式。

### 2.3 定位：工具插件 vs. 服务插件

| 类型 | 说明 | InsightForge 的采用 |
|------|------|---------------------|
| **工具插件** | 注册一个或多个 `defineTool`，由 Agent 在对话中调用 | ✅ 核心形态 |
| **服务插件** | 向 `ctx` 注入可被其他插件依赖的服务能力 | ✅ 预留扩展 |


## 三、功能需求

### 3.1 核心工具

插件将向 dsh 注册以下工具，供 Agent 在对话中调用：

| 工具名 | 功能 | 触发场景示例 |
|--------|------|-------------|
| `market_research` | 基于用户想法进行市场调研，生成结构化报告 | "帮我验证一下远程结对编程工具的市场" |
| `search_demand` | 在本地需求库中检索相关需求数据 | "看看有没有人在讨论 AI 会议纪要工具" |
| `generate_landing` | 生成验证落地页 HTML | "为这个想法生成一个测试页面" |
| `competitor_analysis` | 分析指定领域的竞品信息 | "帮我看看这个赛道有哪些竞品" |

**工具定义规范**（参考 dsh 插件开发标准）：

```typescript
// 以 market_research 为例
defineTool({
  name: 'market_research',
  description: '基于用户提供的产品想法进行市场调研，生成包含市场热度、竞品识别、用户痛点、市场规模估算的结构化报告。当用户需要验证一个产品想法或进行市场分析时使用。',
  parameters: {
    idea: { 
      type: 'string', 
      required: true, 
      description: '用户的产品想法或项目描述' 
    },
    depth: {
      type: 'string',
      required: false,
      description: '调研深度: quick(快速) / standard(标准) / deep(深度)',
      enum: ['quick', 'standard', 'deep']
    }
  },
  output: {
    schema: { /* 报告结构定义 */ },
    render: (_args, value) => [{ type: 'text', text: formatReport(value) }]
  },
  async execute(args, exec) {
    // 调用 InsightForge 核心逻辑
    // 可通过 exec.agent 获取当前会话和工作区上下文
  }
})
```

### 3.2 配置项

插件需支持以下配置（在 `cordis.yml` 中由用户设定）：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `llmProvider` | string | `'deepseek'` | 大模型提供商 |
| `llmApiKey` | string | - | 大模型 API Key（必填） |
| `searchProvider` | string | `'openserp'` | 搜索引擎提供商 |
| `searchEndpoint` | string | `'http://localhost:8080'` | OpenSerp 服务地址 |
| `dbPath` | string | `'./data/insightforge.db'` | 本地需求库路径 |
| `cacheEnabled` | boolean | `true` | 是否启用结果缓存 |
| `maxConcurrent` | number | `5` | 最大并发请求数 |

**配置设计原则**（遵循 dsh 规范）：凡是不同部署可能需要不同值的参数，都必须定义为配置字段，而非硬编码常量。

### 3.3 服务提供（预留扩展）

插件可提供以下服务，供其他 dsh 插件依赖注入：

| 服务名 | 说明 |
|--------|------|
| `insightforge/demand` | 需求库查询服务 |
| `insightforge/report` | 报告生成服务 |
| `insightforge/session` | 调研会话上下文服务 |

服务通过 `ctx.provide()` 注册，其他插件通过 `inject` 声明依赖获取。

### 3.4 非功能需求

| 需求编号 | 描述 | 指标 |
|----------|------|------|
| NFR-01 | 工具执行响应时间（标准深度） | ≤ 3 分钟 |
| NFR-02 | 插件加载时间 | ≤ 3 秒 |
| NFR-03 | 配置校验 | 加载时通过 Schema 校验，无效配置明确报错 |
| NFR-04 | 资源清理 | 插件卸载时清理所有注册的工具、监听器和定时器 |
| NFR-05 | 内存占用 | ≤ 512 MB |
| NFR-06 | 并发支持 | 同一 dsh 实例中支持多个并发调研任务 |


## 四、技术方案

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    DeepSeek Harness                            │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                     dsh Web UI                            │ │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │ │
│  │  │  Client Plugin  │    │  用户对话界面               │  │ │
│  │  │  (前端交互)     │◄──►│  (Agent 调用工具)           │  │ │
│  │  └─────────────────┘    └─────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                     dsh Core                              │ │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │ │
│  │  │  Host Plugin    │───►│  Tool Registry              │  │ │
│  │  │  (InsightForge) │    │  (market_research 等)       │  │ │
│  │  └─────────────────┘    └─────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    InsightForge Core                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │
│  │ 爬虫引擎   │  │ 需求库     │  │ 智能体逻辑              │  │
│  │ (Crawlee)  │  │ (SQLite)   │  │ (市场调研员)            │  │
│  └────────────┘  └────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 目录结构

```
insightforge-dsh-plugin/
├── package.json                 # 包声明，含 dsh.bundle 字段
├── cordis.patch.yml             # Bundle 层：自动插入组合行
├── tsconfig.json
├── src/
│   ├── index.ts                 # Host 插件入口
│   ├── client.ts                # Client 插件入口（./client 子路径）
│   ├── tools/
│   │   ├── market-research.ts   # market_research 工具实现
│   │   ├── search-demand.ts     # search_demand 工具实现
│   │   ├── generate-landing.ts  # generate_landing 工具实现
│   │   └── competitor.ts        # competitor_analysis 工具实现
│   ├── services/
│   │   └── demand-service.ts    # 需求库服务（预留）
│   ├── core/
│   │   ├── researcher.ts        # 市场调研核心逻辑
│   │   └── db.ts                # 数据库访问
│   ├── config.ts                # 配置 Schema 定义
│   └── types.ts                 # 共享类型定义
├── tests/
│   ├── tools.test.ts
│   └── integration.test.ts
└── README.md
```

### 4.3 插件实现模板

**Host 插件入口（src/index.ts）** ：

```typescript
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'insightforge-plugin'
export const inject = ['tools']

export interface Config {
  llmApiKey: string
  searchEndpoint: string
  dbPath: string
}

export const Config: Schema<Config> = Schema.object({
  llmApiKey: Schema.string().required().description('大模型 API Key'),
  searchEndpoint: Schema.string().default('http://localhost:8080').description('OpenSerp 服务地址'),
  dbPath: Schema.string().default('./data/insightforge.db').description('需求库路径'),
})

export function apply(ctx: Context, config: Config) {
  // 初始化 InsightForge 核心
  const forge = new InsightForge(config)

  // 注册工具
  ctx.tools.register(defineTool({
    name: 'market_research',
    // ... 工具定义
    async execute(args) {
      return forge.research(args.idea, args.depth)
    }
  }))

  // 注册其他工具...
}
```

### 4.4 Client 插件（前端交互）

Client 插件通过 `exports["./client"]` 导出，注册 dsh Web UI 的扩展点：

```typescript
// src/client.ts
export const name = 'insightforge-client'
export const inject = ['shell']

export function apply(ctx: Context) {
  // 注册 UI 扩展，例如在对话界面增加 "快速调研" 按钮
  ctx.shell.overlay.register({
    id: 'insightforge-quick-research',
    // 渲染组件...
  })
}
```

Client 插件需要经过 esbuild 打包，以适配浏览器端加载。

### 4.5 Bundle 声明（package.json）

```json
{
  "name": "insightforge-dsh-plugin",
  "version": "0.1.0",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client.js"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*"
  }
}
```

`dsh.bundle` 字段使插件在通过 `dsh plugin add` 安装后自动进入 profile 组合层，无需手工配置 patch。

### 4.6 Cordis 架构适配要点

根据 Cordis 框架规范，插件开发需遵循以下要点：

1. **依赖声明**：使用 `inject` 声明所需服务（如 `['tools']`），框架会在依赖就绪后才激活插件
2. **配置校验**：通过导出的 `Config` Schema 校验用户配置，无效配置在加载时明确报错
3. **资源清理**：所有注册行为（工具、监听器、定时器）使用 `ctx.effect()` 或依赖框架自动清理
4. **服务提供**：如需提供可被其他插件依赖的服务，使用 `ctx.provide()` 导出服务定义

### 4.7 打包与发布

```bash
# 构建
pnpm build

# 发布到 npm
npm publish
```

发布后，用户可通过以下方式安装：

```bash
dsh plugin add insightforge-dsh-plugin
```

或通过 Web UI 的插件管理界面安装。


## 五、Cordis 架构适配

### 5.1 为什么需要适配 Cordis

DeepSeek Harness 底层基于 **Cordis** 插件框架运行。Cordis 解决两个核心问题：

1. **时间可组合性**：插件卸载时，其注册的所有工具、监听器、服务被完整撤销，系统恢复到安装前的状态
2. **空间可组合性**：插件之间的依赖关系被框架管理，Provider 被替换时，依赖它的插件自动感知并适配

InsightForge 插件必须遵循 Cordis 规范，才能确保在 dsh 生态中稳定运行。

### 5.2 关键适配要求

| 适配点 | 要求 | 实现方式 |
|--------|------|----------|
| **插件形态** | 导出 `name` 和 `apply` 函数 | 函数形式即可满足 |
| **依赖声明** | 使用 `inject` 数组声明所需服务 | `export const inject = ['tools']` |
| **配置 Schema** | 使用 `@deepseek-ai/schemastery` 定义 | `export const Config = Schema.object({...})` |
| **资源清理** | 注册行为由框架自动清理，长生命周期资源用 `ctx.effect()` | 工具注册由 `ctx.tools.register` 自动管理 |
| **Client/Host 分离** | 前端交互打包为独立的 client 子路径 | `exports["./client"]` |

### 5.3 测试要求

开发过程中使用隔离的 workspace 测试插件，避免影响真实项目：

```bash
# 使用 patch 加载本地插件进行测试
pnpm dsh web --patch ./cordis.patch.yml
```


## 六、交付物与发布

### 6.1 交付物清单

| 交付物 | 说明 |
|--------|------|
| `insightforge-dsh-plugin` npm 包 | 插件核心代码，包含 Host 和 Client 两端 |
| `README.md` | 安装指南、配置说明、使用示例 |
| API 文档 | 工具参数、配置项、服务接口的完整文档 |
| 测试报告 | 单元测试和集成测试结果 |
| 示例配置 | 完整的 `cordis.yml` 配置示例 |

### 6.2 发布渠道

| 渠道 | 说明 |
|------|------|
| **npm** | 主要发布渠道 |
| **GitHub** | 源码仓库，含 Issues 和 Releases |
| **dsh 社区** | 在 dsh 官方社区或论坛发布插件公告 |

### 6.3 版本规划

| 版本 | 范围 | 预计时间 |
|------|------|----------|
| **v0.1.0** | 核心工具（market_research + search_demand），基础配置 | MVP |
| **v0.2.0** | 增加 generate_landing + competitor_analysis | +2 周 |
| **v0.3.0** | 增加 Client 插件（UI 交互） | +4 周 |
| **v1.0.0** | 服务接口稳定，完整文档和测试 | +6 周 |


## 七、常见问题

**Q1：插件需要完整部署 InsightForge 吗？**

A：不需要。插件将 InsightForge 的核心逻辑打包为 npm 依赖，通过 dsh 的插件机制加载，无需额外部署服务。

**Q2：插件需要哪些外部依赖？**

A：与 InsightForge 个人版一致：大模型 API Key 和搜索引擎 API Key。配置在 dsh 的 `cordis.yml` 中完成。

**Q3：插件与 InsightForge 个人版是什么关系？**

A：两者共享相同的核心逻辑。个人版是独立应用，插件是将核心能力封装为 dsh 可调用的工具。代码可复用，但打包和分发方式不同。

**Q4：用户已有 InsightForge 个人版，还能用插件吗？**

A：可以。插件可以配置为使用已有的需求库（通过 `dbPath` 配置项），实现数据共享。


## 附录：参考资源

| 资源 | 地址 |
|------|------|
| DeepSeek Harness 官方仓库 | https://github.com/deepseek-ai/deepseek-harness |
| DeepSeek Harness 实战手册 | https://zoahdev.github.io/deepseek-harness-handbook/ |
| 插件开发官方文档 | https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/develop |
| dsh-trail-plugin 参考实现 | https://www.npmjs.com/package/dsh-trail-plugin |

---

*本文档基于 DeepSeek Harness v0.1 开发者预览版编写。后续版本如有 API 变动，请以官方文档为准。*