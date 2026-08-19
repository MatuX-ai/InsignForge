# 📣 InsightForge dsh Plugin 社区公告

> 适用于 dsh 社区论坛、Discord 频道、GitHub Discussion 置顶帖。
> 发布前请将占位符 `<...>` 替换为真实信息。

---

**标题**:`[插件发布] InsightForge — 一站式市场调研能力,接入 dsh 只需 5 分钟`

**标签**:`plugin` `market-research` `ai-agent` `tools` `release`

---

## 🎉 简介

大家好,我们非常激动地宣布 **InsightForge dsh Plugin v0.1.0** 正式发布!

InsightForge 原本是独立的市场调研工具,现在它以 **dsh 插件** 的形式与 Cordis 生态完整融合。
无需独立部署,只需两个 API Key(LLM + 搜索)即可在你的 dsh 应用中获得专业级市场调研能力。

## ✨ 核心能力(4 个工具 + 3 个服务)

### 工具层(可在 dsh 会话中直接调用)

| 工具 | 能力 | 典型耗时 |
|------|------|---------|
| `market_research` | 三档深度调研,生成 7 章节结构化报告 | quick=60s · standard=180s · deep=360s |
| `search_demand` | 在本地需求库中全文检索(FTS5) | <1s |
| `generate_landing` | 一键生成响应式落地页 HTML | <2s |
| `competitor_analysis` | 提取指定行业竞品画像 | <90s |

### 服务层(供其他插件调用)

- `insightforge/demand` — 需求库查询
- `insightforge/report` — 报告生成(绕过工具层)
- `insightforge/session` — 调研会话上下文

## 🚀 5 分钟上手

```bash
# 1. 安装
pnpm add insightforge-dsh-plugin

# 2. 在 cordis.yml 中声明(完整示例见 docs/cordis.yml.example)
# plugins:
#   insightforge-plugin:
#     $: insightforge-dsh-plugin
#     Config:
#       llmApiKey: ${DEEPSEEK_API_KEY}

# 3. 启动 dsh web
pnpm dsh web --patch
```

## 📊 设计亮点

1. **零外部依赖**:核心逻辑全部内联到 npm 包,无需额外服务
2. **共享需求库**:与 InsightForge 个人版共用 `dbPath`,检索个人版积累的需求
3. **三档深度**:quick / standard / deep 灵活应对不同场景
4. **结果可缓存**:LRU + 24h TTL,避免重复调研烧 token
5. **并发安全**:`maxConcurrent` 信号量 + SQLite WAL 模式
6. **Cordis 原生适配**:`ctx.effect()` + `ctx.onDispose()` 双保险清理

## 🔌 与其他插件协同

```typescript
// 在你的插件中消费 InsightForge 服务
export const inject = ['insightforge/demand'];

export function apply(ctx, config) {
  const demand = ctx.inject('insightforge/demand');
  const hits = demand.search('AI meeting notes', 10);
  // ... 基于需求库做后续推理
}
```

## 📦 版本与里程碑

| 版本 | 内容 | 状态 |
|------|------|------|
| **v0.1.0** | 2 个核心工具 + Config + 测试 | ✅ 已发布 |
| **v0.2.0** | + generate_landing + competitor_analysis | ✅ 已发布 |
| **v0.3.0** | + Client UI 完整交互(esbuild IIFE) | ✅ 已发布 |
| **v1.0.0** | 3 个服务接口稳定 + 完整文档 | ✅ 已发布 |

## 🔗 链接

- npm: <https://www.npmjs.com/package/insightforge-dsh-plugin>
- GitHub: <https://github.com/your-org/insightforge-dsh-plugin>
- 文档: <https://github.com/your-org/insightforge-dsh-plugin/blob/main/docs/API.md>
- 示例配置: <https://github.com/your-org/insightforge-dsh-plugin/blob/main/docs/cordis.yml.example>
- 需求说明(中文): `docs/InsightForge —— DeepSeek Harness 插件需求文档.md`

## 🙏 致谢

- 感谢 dsh 团队提供的 Cordis 框架
- 感谢 InsightForge 个人版积累的 prompt / schema / 聚合算法
- 感谢 OpenSerp / HN Algolia / Reddit JSON 提供的开放搜索能力

## 💬 反馈渠道

- GitHub Issues: <https://github.com/your-org/insightforge-dsh-plugin/issues>
- dsh 社区: <https://github.com/deepseek-ai/dsh/discussions>
- Discord: <频道链接>

---

> 如果这个插件对你有帮助,欢迎 ⭐ Star 仓库、分享给团队、在社区打卡!
> 我们期待看到你基于 InsightForge 构建的创意应用 🚀