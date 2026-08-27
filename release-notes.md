# InsightForge v1.2.0

UX 优化、可访问性加固、CI 修复。

## 新特性

### 复制并重新调研

Report 页顶部按钮区新增 “📋 复制并重新调研” 按钮，一键基于现有项目描述创建新项目并重新运行调研，避免覆盖原报告，适合多角度验证场景。

### 导出进度反馈

PDF/Markdown/JSON 导出时顶部出现进度卡片，明示三个阶段（连接后端 / 后端生成中 / 下载到本地）与已用秒数。长报告生成时 ≥8 秒后会提示 “⏳ 大报告生成时间可能稍长，请勿关闭页面…”，完成后 2 秒内显示 “✅ 已下载到本地” 的绿色提示。

## 体验打磨

- **Report 页**：8 个导出/分享/流程按钮重新组织为 3 组（分享导出 / 流程动作 / 高级产物）；节区重新排序并加分割线；横滚章节导航 (TOC) 带 scroll-spy 联动与键盘导航。
- **Settings 页**：未保存变更指示器 + Revert 按钮 + beforeunload 页面离开守卫。
- **History 页**：4 种排序（最新/最早/热度↓/竞品数↓）。
- **Discuss 页**：输入框为空时提示 4 个模板；实时字数计数器；发送按钮 ⏎ 提示。
- **Home 页**：调研创建过程中联动展示自动重试进度（指数退避 1s/2s/4s）。
- **TopBar**：移动端汉堡菜单 + 完整 a11y 属性。

## 可访问性与健壮性

- **Modal**：完整 focus trap（自动聚焦 + Tab/Shift+Tab 循环 + 关闭还原焦点）。
- **Dropdown**：↑↓ 菜单项循环跳过 disabled + 关闭后焦点还原到 trigger。
- **ReportToc**：方向键 ←→/Home/End 导航 + roving tabindex + scroll-spy。
- **iframe**（落地页预览）：改为 `sandbox=""` 完全沙箱化。
- **剪贴板**：`shareLink` / `copySummary` 在非 HTTPS 或旧浏览器自动降级到 `textarea + execCommand`，且不管成败保证 textarea 节点被清理。
- **useResearch**：网络瞬时错误指数退避自动重试 3 次；同时暴露手动 `retry()`。

## 设计系统

- 引入语义化 token：`text-body` / `text-helper` / `text-label` / `text-title` / `text-section` / `text-display`。
- Card 组件新增 5 种 `tone` 变体（default / primary / success / danger / warning）。
- Button / Report 页全面替换魔法字号为 token。

## 工程

- **CI 修复**（`.github/workflows/ci.yml`）：最近 3 次 CI 都因 “Cannot find module '@insightforge/core'” 失败，原因是其他 workspace typecheck 时 core/mcp-server 还未产出 `dist/`。已在 typecheck step 之前构建依赖包。

---

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
