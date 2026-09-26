# InsightForge 个人版

> 让每一个好想法在被投入大量资源之前,先得到数据的检验。

> **📝 仓库命名说明**: GitHub 仓库 URL 为 `MatuX-ai/InsignForge`(`In-sighn-Forge`,历史遗留拼写),
> 但本项目所有文档、代码、UI、品牌均统一使用 **InsightForge**(`In-sight-Forge`)。
> 两者指代同一个项目,无需困惑。

完全本地化、一键 Docker 启动的市场验证工具箱。在 5 分钟内把一个模糊的产品想法变成有数据支撑的市场报告。

**🌐 官网与下载:[insightforge.dev](https://insightforge.dev)**(参见 [`website/`](./website) 目录)

## 特性

- **零云依赖**: 所有数据存储在本地 SQLite,无需注册任何平台
- **极简操作**: 输入一句话想法,自动生成 10 章节市场报告
- **智能聚合**: 集成 OpenSerp 搜索 + Reddit / Hacker News 社区讨论
- **结构化报告**: 市场热度、竞品识别、用户痛点、市场规模、风险机会、数据来源
- **多渠道分发**: Web(Docker)、桌面版(NSIS 安装包/便携版)、DeepSeek Harness 插件、MCP Server

## 快速开始

### 桌面版(Windows 推荐)

无需 Docker 与 Node.js 环境,下载即用:

| 产物 | 说明 |
|------|------|
| `InsightForge-1.8.0-x64.exe` | NSIS 安装程序,支持选择安装目录、创建桌面/开始菜单快捷方式 |
| `InsightForge-1.8.0-portable-x64.exe` | 便携版,双击直接运行,免安装 |

- 应用内置后端子进程,自动使用随机端口,不与本机其他服务冲突
- 数据与配置写入用户目录(`%APPDATA%\InsightForge`),卸载/删除后不残留
- 首次使用需在「设置」页填入 DeepSeek 或 OpenAI API Key

### 前提条件

- Docker Desktop ≥ 24.0
- (可选) Node.js ≥ 22,用于本地开发模式
- DeepSeek 或 OpenAI API Key (二选一)

### 一键启动(Docker)

```bash
# 1. 克隆并进入目录(SSH)
git clone git@github.com:MatuX-ai/InsignForge.git insightforge
cd insightforge

# 或者 HTTPS 方式
# git clone https://github.com/MatuX-ai/InsignForge.git insightforge

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env,填入 LLM_API_KEY

# 3. 启动所有服务
docker-compose up -d

# 4. 打开浏览器
# http://localhost:3000
```

### 仅 Windows / PowerShell

```powershell
Copy-Item .env.example .env
# 记事本编辑 .env
docker-compose up -d
```

### 本地开发模式(无需 Docker)

```bash
# 后端
cd backend
npm install
npm run dev

# 前端(新开终端)
cd frontend
npm install
npm run dev
```

## 目录结构

```
insightforge/
├── desktop/           Electron 桌面版 (main.cjs + electron-builder 配置)
├── frontend/          React 18 + Vite + Tailwind,端口 3000
├── backend/           Node.js + Express + Mastra + SQLite,端口 3001
├── workflow/          Workflow Automation MVP,端口 5678 (预留)
├── crawler/           Crawlee + Playwright 独立爬虫服务
├── docs/              项目文档 (4 份原始 Markdown)
├── scripts/           启动/运维脚本
├── data/              SQLite 数据库与运行时数据 (git ignore)
├── docker-compose.yml 一键编排
├── .env.example       环境变量模板
└── README.md          本文件
```

## 构建桌面版(开发)

```bash
# 1. 安装根依赖(构建脚本依赖)
npm install

# 2. 构建桌面版(编译后端/前端 + 组装 resources + 打包安装程序)
cd desktop
npm install
npm run dist          # 产物输出到 desktop/dist/*.exe

# 仅生成免安装目录(快速验证)
npm run pack
```

- `desktop/build.mjs`: 编译后端与前端,组装 `desktop/resources/{backend,frontend-dist}`
- `desktop/electron-builder.yml`: 安装包/便携版产物配置
- 打包需联网下载 electron 二进制与 NSIS 工具(已配置 npmmirror 镜像加速)

## 使用流程

1. 浏览器打开 `http://localhost:3000`
2. 在文本框中描述产品想法,例如:
   > 一个帮助程序员远程结对编程的 VS Code 插件
3. 点击 **验证想法**,等待 2-5 分钟
4. 浏览 10 章节结构化报告(执行摘要 / 可行性评分 / 行动建议 / 市场热度 / 竞品识别 / 竞品对比矩阵 / 用户痛点 / 市场规模 / 风险与机会 / 数据来源)
5. (可选) 点击 **生成验证页** 获得可分享落地页

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects` | 创建新项目 |
| POST | `/api/v1/projects/:id/research` | 触发市场调研 |
| GET | `/api/v1/projects/:id/status` | 轮询调研状态 |
| GET | `/api/v1/projects/:id/report` | 获取报告 |
| POST | `/api/v1/projects/:id/landing` | 生成验证落地页(预留) |
| GET | `/api/v1/projects/:id/insightforge/download` | 导出 `.insightforge` 项目快照 |
| POST | `/api/v1/projects/import` | 导入 `.insightforge` 项目快照 |
| GET | `/api/v1/projects/:id/discussions` | 列出项目历史讨论 |

详细接口规范见 `docs/03-技术文档.md` §4.2。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite + Tailwind CSS + TypeScript |
| 后端 | Node.js 22 + Express + TypeScript + better-sqlite3 |
| 智能体 | Mastra (@mastra/core) |
| 数据采集 | OpenSerp + Crawlee + Playwright + 知乎/掘金 |
| 数据库 | SQLite (开发) / PostgreSQL (生产预留) |
| 桌面 | Electron 33 + electron-builder 24 |
| 部署 | Docker Compose |

详细技术说明见 `docs/03-技术文档.md`。

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| 端口 3000/3001 被占用 | 修改 `.env` 中 `FRONTEND_PORT` / `BACKEND_PORT` |
| API 调用 401 | 检查 `.env` 中 API Key 是否正确 |
| 报告生成超时 | 调整 `RESEARCH_TIMEOUT`;检查网络 |
| OpenSerp 无数据 | 访问 `http://localhost:8080` 确认服务存活 |
| Docker 启动失败 | `docker-compose logs backend` 查看详情 |
| 桌面版无法启动 | 查看 `%APPDATA%\InsightForge` 下日志与 `.env`;确认无残留进程后重试 |

## 开发路线

- **v1.0 (MVP 已发版)**: 核心闭环 - 想法输入 → 报告生成
- **v1.1**: 多场景文档生成(商业计划书/技术选型/前端设计/讨论协作)
- **v1.2**: UX 优化 + 可访问性加固 + 设计系统语义化 token
- **v1.3**: 采集引擎可靠性基座(重试/熔断/去重/缓存) + 健康检查 + Monitor
- **v1.6 / v1.7 / v1.7.1**: 中文数据源接入(知乎/掘金) + 全面审计修复 + 离线模式 + 代理池
- **v1.8 (当前)**: 桌面端深度集成(单实例/深度链接/原生对话框) + 数据可视化(雷达图/环形饼图) + 项目快照 `.insightforge` 导入导出 + 报告对比视图 + 我的模板 + 标签 + 快捷键 + 批注 + 移动端手势
- **v2.0**: 团队版、Casdoor 多用户、快照加密与差量同步

## 许可证

MIT License - 详见各模块 LICENSE 文件。