# InsightForge 个人版

> 让每一个好想法在被投入大量资源之前,先得到数据的检验。

完全本地化、一键 Docker 启动的市场验证工具箱。在 5 分钟内把一个模糊的产品想法变成有数据支撑的市场报告。

**🌐 官网与下载:[insightforge.dev](https://insightforge.dev)**(参见 [`website/`](./website) 目录)

## 特性

- **零云依赖**: 所有数据存储在本地 SQLite,无需注册任何平台
- **极简操作**: 输入一句话想法,自动生成 7 章节市场报告
- **智能聚合**: 集成 OpenSerp 搜索 + Reddit / Hacker News 社区讨论
- **结构化报告**: 市场热度、竞品识别、用户痛点、市场规模、风险机会、数据来源
- **多渠道分发**: Web(Docker)、桌面版(NSIS 安装包/便携版)、DeepSeek Harness 插件、MCP Server

## 快速开始

### 桌面版(Windows 推荐)

无需 Docker 与 Node.js 环境,下载即用:

| 产物 | 说明 |
|------|------|
| `InsightForge-1.0.0-x64.exe` | NSIS 安装程序,支持选择安装目录、创建桌面/开始菜单快捷方式 |
| `InsightForge-1.0.0-portable-x64.exe` | 便携版,双击直接运行,免安装 |

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
4. 浏览 7 章节结构化报告
5. (可选) 点击 **生成验证页** 获得可分享落地页

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects` | 创建新项目 |
| POST | `/api/v1/projects/:id/research` | 触发市场调研 |
| GET | `/api/v1/projects/:id/status` | 轮询调研状态 |
| GET | `/api/v1/projects/:id/report` | 获取报告 |
| POST | `/api/v1/projects/:id/landing` | 生成验证落地页(预留) |

详细接口规范见 `docs/03-技术文档.md` §4.2。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite + Tailwind CSS + TypeScript |
| 后端 | Node.js 22 + Express + TypeScript + better-sqlite3 |
| 智能体 | Mastra (@mastra/core) |
| 数据采集 | OpenSerp + Crawlee + Playwright |
| 工作流 | Workflow Automation MVP (Express) |
| 数据库 | SQLite (开发) / PostgreSQL (生产预留) |
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

- **v1.0 (当前 MVP)**: 核心闭环 - 想法输入 → 报告生成
- **v1.1**: 数据可视化图表、Markdown/PDF 导出
- **v1.2**: 自定义数据源、Ollama 本地模型
- **v2.0**: 团队版、Casdoor 多用户

## 许可证

MIT License - 详见各模块 LICENSE 文件。