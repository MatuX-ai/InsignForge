# Crawler 服务

> 当前 MVP 阶段为占位,v1.2 接入真实 Crawlee + Playwright 抓取 JS 渲染页面。

## 现状

MVP 阶段的数据采集已实现在后端 `backend/src/services/search/` 模块中,使用:

- **OpenSerp** - 自托管搜索引擎,需要 Docker 部署
- **Hacker News Algolia** - 公开 JSON API,无需 Key
- **Reddit JSON** - 公开搜索接口,无需 Key

这些已覆盖技术文档 §3.5 中描述的"论坛数据采集"大部分场景。

## v1.2 计划

| 数据源 | 抓取方式 | 优先级 |
|--------|----------|--------|
| Product Hunt | Crawlee + Playwright (JS 渲染) | P1 |
| App Store 评论 | Playwright + Apple 公开页 | P1 |
| 知乎 / 微博 | Playwright + 反爬策略 | P2 |
| Twitter/X | 第三方监控 | P3 |

## 本地开发

```bash
npm install
npm run dev
```

详细抓取脚本将在 v1.2 阶段补全。