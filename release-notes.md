## InsightForge MVP v1.0.0

首个公开版本。本地化、一键启动的市场验证工具箱 —— 在 5 分钟内把一个模糊的产品想法变成有数据支撑的市场报告。

### 特性

- **一句话输入 → 7 章节结构化报告**：市场热度、竞品识别、用户痛点、市场规模、风险机会、数据来源
- **多源数据聚合**：集成 OpenSerp 搜索 + Reddit 社区讨论 + Hacker News 技术圈动态
- **全本地存储**：SQLite 本地化，无云依赖、无注册、无账号
- **一键部署**：Docker Compose 一条命令拉起所有服务
- **Mastra 智能体编排**：基于 `@mastra/core` 的可扩展 Agent 架构

### 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 18 + Vite + Tailwind CSS + TypeScript |
| 后端 | Node.js 22 + Express + TypeScript + better-sqlite3 |
| 智能体 | Mastra (`@mastra/core`) |
| 数据采集 | OpenSerp + Crawlee + Playwright |
| 数据库 | SQLite (开发) / PostgreSQL (生产预留) |
| 部署 | Docker Compose |

### 快速开始

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

### 文档

- `docs/01-项目说明与需求说明书.md` — 产品需求
- `docs/02-前端设计文档.md` — 前端架构
- `docs/03-技术文档.md` — 技术细节
- `docs/04-用户中心需求文档.md` — 用户中心规划

### 路线图

- **v1.0 (当前)**：核心闭环 —— 想法输入 → 报告生成
- **v1.1**：数据可视化图表、Markdown / PDF 导出
- **v1.2**：自定义数据源、Ollama 本地模型
- **v2.0**：团队版、Casdoor 多用户

---

许可证：MIT