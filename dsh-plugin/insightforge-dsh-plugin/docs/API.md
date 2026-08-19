# InsightForge dsh Plugin — API 文档

本文档详细描述 `insightforge-dsh-plugin` 的工具参数、配置项与服务接口。

## 目录

- [工具(Tools)](#工具tools)
  - [market_research](#market_research)
  - [search_demand](#search_demand)
  - [generate_landing](#generate_landing)
  - [competitor_analysis](#competitor_analysis)
- [配置(Config)](#配置config)
- [服务(Services)](#服务services)
- [错误码与诊断](#错误码与诊断)

---

## 工具(Tools)

### market_research

基于用户提供的产品想法进行市场调研,生成包含 7 章节的结构化报告。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `idea` | string | ✓ | - | 产品想法或项目描述,≥ 3 个字符 |
| `depth` | 'quick' \| 'standard' \| 'deep' | ✗ | 'standard' | 调研深度档位 |

**输出**(Markdown 渲染 + JSON 双形式):

```typescript
interface MarketReport {
  summary: string;
  market_heat: {
    search_volume: number;
    discussion_count: number;
    trend: 'rising' | 'stable' | 'declining';
    heat_score: number;  // 0-100
  };
  competitors: Array<{
    name: string;
    description: string;
    url?: string;
    strengths?: string[];
    weaknesses?: string[];
  }>;
  pain_points: string[];
  market_size: string;
  risks: string[];
  opportunities: string[];
  sources: Array<{ title: string; url: string; date?: string; source?: string }>;
  generated_at: string;  // ISO 8601
  depth: 'quick' | 'standard' | 'deep';
  keywords: string[];
}
```

**深度档位参数差异**:

| 档位 | 关键词数 | maxTokens | 搜索上限 | 预估耗时 |
|------|---------|-----------|---------|---------|
| quick | 3 | 1500 | 30 | 60s |
| standard | 5 | 4000 | 80 | 180s |
| deep | 8 | 8000 | 150 | 360s |

---

### search_demand

基于 SQLite FTS5 在本地需求库中检索相关条目。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | ✓ | - | 检索关键词 |
| `limit` | number | ✗ | 20 | 返回条数上限,最大 100 |

**输出**:

```typescript
interface DemandHit {
  id: string;
  title: string | null;
  content: string;
  source: 'reddit' | 'hackernews' | 'google' | 'bing' | 'producthunt';
  url: string | null;
  engagement: number;
  crawled_at: string;
}
```

**说明**:
- 个人版产生的需求数据会自动出现在检索结果中(FAQ Q4)
- 若 `dbPath` 指向的数据库不存在,FTS5 检索会降级为 LIKE 查询(返回空数组)

---

### generate_landing

生成单文件响应式落地页 HTML。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `idea` | string | ✓ | - | 主标题 |
| `value_proposition` | string | ✓ | - | 核心价值主张 |
| `call_to_action` | string | ✗ | '加入等待列表' | CTA 按钮文案 |
| `theme` | 'light' \| 'dark' | ✗ | 'light' | 主题 |
| `tagline` | string | ✗ | - | 副标题 |

**输出**:

```typescript
interface LandingPage {
  html: string;       // 完整 HTML 文档
  size: number;       // 字节数
  theme: 'light' | 'dark';
}
```

**安全**:所有用户输入会进行 HTML 转义,避免 XSS。

---

### competitor_analysis

分析指定行业的竞品。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `domain` | string | ✓ | - | 行业/赛道关键词 |
| `limit` | number | ✗ | 5 | 期望返回数量,最大 20 |

**输出**:

```typescript
interface CompetitorEntry {
  name: string;
  description: string;
  url?: string;
  strengths?: string[];
  weaknesses?: string[];
  market_position?: 'leader' | 'challenger' | 'niche';
  source_urls?: string[];
}
```

---

## 配置(Config)

通过 `cordis.yml` 中的 `plugins.insightforge-plugin.Config` 段配置,由 schemastery 自动校验。

| 字段 | 类型 | 默认值 | 必填 | 说明 |
|------|------|--------|------|------|
| `llmProvider` | 'deepseek' \| 'openai' \| 'ollama' | 'deepseek' | ✗ | LLM 提供商 |
| `llmApiKey` | string | - | ✓ | LLM API Key(ollama 可用占位符) |
| `searchProvider` | 'openserp' \| 'serpapi' | 'openserp' | ✗ | 搜索引擎 |
| `searchEndpoint` | string | 'http://localhost:8080' | ✗ | OpenSerp 服务地址 |
| `dbPath` | string | './data/insightforge.db' | ✗ | SQLite 数据库路径 |
| `cacheEnabled` | boolean | true | ✗ | 是否启用结果缓存 |
| `maxConcurrent` | number (1-32) | 5 | ✗ | 最大并发调研任务数 |

**示例**:

```yaml
plugins:
  insightforge-plugin:
    $: insightforge-dsh-plugin
    Config:
      llmProvider: deepseek
      llmApiKey: ${DEEPSEEK_API_KEY}
      searchEndpoint: http://openserp:8080
      dbPath: ./data/insightforge.db
      maxConcurrent: 5
```

---

## 服务(Services)

通过 `ctx.provide()` 注入,其他 dsh 插件可通过 `inject` 声明依赖。

### insightforge/demand

需求库查询服务。

```typescript
interface DemandService {
  search(query: string, limit?: number): DemandHit[];
  searchNeeds(query: string, limit?: number): MarketNeed[];
  stats(): DemandStats;
}
```

**使用示例**(其他插件):

```typescript
export const inject = ['insightforge/demand'];

export function apply(ctx, config) {
  const demand = ctx.inject<DemandService>('insightforge/demand');
  const hits = demand.search('AI meeting', 10);
  console.log(`找到 ${hits.length} 条需求`);
}
```

### insightforge/report

报告生成服务(绕过工具调用层,直接生成)。

```typescript
interface ReportService {
  generate(req: ResearchRequest): Promise<ResearchResult>;
  generateReportOnly(req: ResearchRequest): Promise<MarketReport>;
  peekCache(idea: string, depth?: ResearchDepth): MarketReport | null;
}
```

### insightforge/session

调研会话上下文服务。

```typescript
interface SessionService {
  create(idea: string, depth?: ResearchDepth): ResearchSession;
  get(id: string): ResearchSession | undefined;
  list(): ResearchSession[];
  delete(id: string): boolean;
}
```

---

## 错误码与诊断

| 错误 | 触发场景 | 建议 |
|------|---------|------|
| `参数 idea 必须是非空字符串` | tool 入参缺失 | 检查 idea 长度 ≥ 3 |
| `LLM 调用失败:...` | LLM API 异常 | 检查 llmApiKey / 网络 |
| `OpenSerp 调用失败,跳过` | 搜索源失败 | 检查 searchEndpoint |
| `报告结构不符合预期` | LLM 输出无法解析 | 重试或降低 depth |
| `Configuration X is required` | 加载时配置缺失 | 补充 cordis.yml Config 段 |
| `dbPath 无效或不可写` | SQLite 创建失败 | 检查目录权限 |

所有错误会在 pino 日志中结构化记录,级别 `error`,字段包含 `err` / `provider` / `model` 等。

---

## 版本与兼容性

| 插件版本 | dsh 版本 | Node.js | TypeScript |
|---------|---------|---------|------------|
| 0.1.0 - 1.0.0 | >= 0.1.0 | >= 22 | >= 5.6 |

---

## 参考

- 完整源代码:`src/`
- 测试用例:`tests/`
- 部署示例:`docs/cordis.yml.example`
- 公告草稿:`docs/ANNOUNCEMENT.md`