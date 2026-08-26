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
