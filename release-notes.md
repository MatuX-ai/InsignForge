# InsightForge v1.8.1 (文档同步 · 版本号统一 · 发布资产)

> v1.8.0 的里程碑式发版后,后续 3 个 commit 完成了 BUG-01 修复与品牌资产统一。
> 本次发版将这 3 个 commit 合并发布为 v1.8.1,同时把仓库内散落的版本号统一到 1.8.1。

## v1.8.1 增量

- `02d70aa` P11:BUG-01 修复(MISSING_API_KEY 弹窗) + DeepSeek 模型配置 + 全 Provider 接口同步
- `480b6b3` P12:桌面端无边框窗口自定义顶栏 + 品牌 Logo 统一来源
- 本次发版附带完成:版本号统一(根/frontend/backend/desktop/website)、release-notes 补齐 P10-P12、
  README 补齐 P11+P12、AUDIT 报告 5.2 节 Aggregator.test.ts 预存量问题已修(8/8 PASS)

# InsightForge v1.8.0 (桌面端深度集成 · 数据可视化 · 项目快照导入导出)

## 背景

v1.7 在中文源接入上完成了「数据可达性」,v1.8 将 v1.7 引入的中文社区信号沉淀为可对外分享的项目快照,
同时把 InsightForge 从「本地 + Docker + 桌面」三形态向「桌面优先 + 跨实例迁移」演进。
报告章节从 7 个扩展到 10 个(新增 可行性评分 / 行动建议 / 竞品对比矩阵),桌面版 Windows NSIS 安装包
稳定可用。

## 重大变化

- **桌面版 Windows 一等公民**: `main.cjs` 落地 `app.getPath('userData')` 写入 `%APPDATA%\InsightForge`,
  单实例锁 `requestSingleInstanceLock` 防多开,resourcePath fallback 兜底不崩;SIGTERM 优雅关闭。
- **项目快照 `.insightforge`**: 把项目报告 + 讨论 + 注释 + 标签 + 元数据打成 ZIP,跨实例可分享与导入;
  包含完整性校验(SHA-256)与版本号断言。
- **报告对比视图**: 多份报告并排陈列,自动识别共同竞品/差异化维度/趋势分歧。
- **数据可视化双核**: `SourceDonut`(数据来源环形饼图)+ `CompetitorRadar`(竞品五维雷达图)进入报告页。

## P0 + P1 + P2 — 桌面端 UI 精雕细琢(commit `71c1222`)

> 这是 v1.8 的奠基 commit:一份提交就完成桌面端 41 个文件的打磨,2470 行新增。

### 桌面版基础设施

- `desktop/main.cjs`(+281 行):
  - `app.getPath('userData')` 写入配置/数据库/日志,与 Windows 标准对齐(卸载/迁移零残留)
  - 进程退出 `SIGTERM` 优雅关闭(原 5 秒超时问题根因修复)
  - `resourcePath` 兜底 fallback(production 找不到 resource 时不崩)
  - 启动 logo 闪烁问题修复
- 新增组件:`DesktopNavigator` / `DesktopOnly` / `useDesktopApi` Hook,Web/桌面能力桥
- `electron-builder.yml`:产物命名规范,Windows NSIS + 便携版双产物

### 报告页输出控制

- 新增 `PaperSizePicker`(162 行):A4 / Letter / A3 / 信纸 / 法律 / 自定义,默认按 locale 推荐
- 新增 `pdfPreferences.ts`(117 行):边距/页眉/页脚/水印模板统一管理
- 新增 `Container` 组件(86 行):统一卡片/页面骨架,断点响应

### 设置与体验

- `Banner`(+87):成功/警告/信息/危险 4 态,与设计系统 tone 对齐
- `GlobalOfflineBanner`(+107):全局离线状态指示
- `OnboardingModal` 修订 + `LlmSetupPrompt` 修订:首启流程闭环,Provider 列表真实化
- `Monitor` 角色说明补全,`Faq` Provider 列表更新
- `Textarea` 自适应高度 + 字符计数,`Dropdown` 键盘可达性
- `Modal` 重写 focus trap(visibility check + Tab/Shift+Tab 循环)
- `TopBar` 注入 `VITE_APP_VERSION`,用户菜单完整 a11y 属性

### 设计系统

- 语义化 token 完整落地:`text-body` / `text-helper` / `text-label` / `text-title` / `text-section` / `text-display`
- `Card` 5 种 `tone` 变体(default / primary / success / danger / warning)
- `Button` outline/ghost 变体 + loading 状态
- `tailwind.config.js`:WCAG AA/AAA 颜色对比度校准

## P3 — 数据可视化与可访问性补强(commit `1ee61d5`)

- 报告页新增市场规模单位与年份自适应
- TopBar 与 Modal 增强屏幕阅读器体验(`aria-label` / `aria-expanded` / 焦点还原)

## P4 — 深度链接 + 首屏加载窗口 + 推断详情(commit `676f1e2`)

> 桌面版 3 大体验提升,total 413 行新增。

- `desktop/main.cjs`(+314):
  - **深度链接 `insightforge://`**:从外部链接直接打开具体报告页(桌面分发场景核心)
  - **首屏加载窗口**:Electron `BrowserWindow` 启动窗口,白屏期不裸露空白
  - **OS-specific PDF 步骤**:Windows / macOS / Linux 三平台导出指引差异化
- 报告页 `InferenceDetail`:鼠标 hover 显示数据置信度与样本来源

## P5 — 报告对比视图(commit `1bad720`)

> 协作场景核心入口,Compare.tsx 单文件 433 行。

- 新增 `/compare` 页(`Compare.tsx`):选择 2-4 份历史报告并排陈列
- 自动识别**共同竞品**(横跨多份报告均出现的实体)
- 自动识别**差异化维度**(各报告侧重点的差异)
- 自动识别**趋势分歧**(同一指标的不同结论)
- 报告卡片支持勾选 + 时间线视图

## P6 — 讨论模板 + 错误恢复 + 报告批注(commit `955b823`)

- **报告批注**:`SectionAnnotation` + `useAnnotations` 闭环
  - 选中报告任意段落即可添加批注(@mention / 时间戳 / 状态:open/resolved)
  - 批注列表抽屉式展示,按章节聚合
- **讨论模板**:10 条模板按画布类型(竞品 / 痛点 / 市场规模)组织
- **错误恢复 `wait_and_retry`**:报告生成失败时显示倒计时 + 进度条,自动重试或一键诊断

## P7 — 我的模板 + 项目标签 + 键盘快捷键(commit `f4b8eb4`)

> 工作流闭环三轮,total 799 行新增。

- `useIdeaTemplates`:常用调研想法保存为模板,首页下拉一键复用
- `useProjectTags`:项目可打多维度标签(行业/阶段/优先级),历史页按标签过滤
- `useKeyboardShortcuts` + `ShortcutsHelp` + `ShortcutsHost`:
  - `Ctrl/Cmd+K` 命令面板
  - `Ctrl/Cmd+Enter` 提交
  - `Esc` 关闭对话框
  - `?` 唤出快捷键帮助
- 首页底部新增 `BottomBar`:快捷键提示 + 实时字数

## P8 — 画布折叠 + 复制 Markdown + 移动端手势(commit `dc4616a`)

- `useDiscussCollapse`:讨论区画布可折叠,腾出报告区阅读空间
- 报告页一键复制为 Markdown(含章节结构 + 数据表)
- `useSwipeBack`:移动端右滑返回上一页(原生体验)
- `Modal` 移动端全屏模式优化

## P9 — 数据可视化 + 桌面端集成 + 项目快照导入导出(commit `74e2b90`)

> v1.8 收尾三轮,10 文件 / 1609 行新增。

### 项目快照 `.insightforge`

- 新增 `backend/src/services/InsightforgePackageService.ts`(519 行):
  - ZIP STORE 格式(无压缩,本地场景速度优先)
  - 包含:`manifest.json` + `report.json` + `discussions.json` + `annotations.json` + `tags.json`
  - 完整性校验:SHA-256 哈希写入 manifest,导入时校验
  - 版本号断言:低版本不能导入高版本快照
- 后端路由:
  - `GET /api/v1/projects/:id/insightforge/download` — 导出快照
  - `POST /api/v1/projects/import` — 接收 raw body 直接吃二进制(避免 multer 依赖)
- 新增 `insightforgePackage.test.ts`(309 行,9 case → 9/9 PASS):覆盖导出/导入/校验/版本/边界

### 数据可视化组件

- `SourceDonut`(178 行):纯 SVG 环形饼图,role/aria-label/title 完整,< 3% 来源合并为「其他」
- `CompetitorRadar`(195 行):5 维度雷达(优势密度/数据透明/描述完整/官网可达/数据丰富)
  - < 2 竞品时不渲染,避免误导

### 桌面端集成

- `desktop/main.cjs`(+186):下载用 `dialog.showSaveDialog` 原生保存,导入用 `dialog.showOpenDialog` + `.insightforge` 过滤
- 历史页头部新增「📥 导入快照」按钮,与项目卡片「📦 导出快照」按钮对称

## P10 — 文档同步 + 版本号 1.8.0 + Aggregator mock 闭环(commit `786a016`)

> v1.8 里程碑发版准备,7 文件 / +473 / -13。详俌[P0-P9 完整 changelog](#p0--p1--p2--桌面端-ui-精雕细琢commit-71c1222)。

- `release-notes.md`:顶部新增 v1.8.0 完整 changelog,覆盖 P0-P9 九轮迭代
  (桌面端深度集成/数据可视化/项目快照导入导出/报告对比/批注/模板/标签/快捷键/移动端手势),含工程指标/兼容性/核对清单
- `README.md`:同步版本号 `InsightForge-1.0.0  1.8.0`,章节数 `7  10`,
  API 表格 +3 路由(快照下载/导入/讨论列表),技术栈表格更新,开发路线更新到 v1.8 当前 + v2.0 规划
- `backend/frontend/desktop` 三处 `package.json` 版本号同步:
  backend/frontend 1.7.0  1.8.0,desktop 0.1.15  0.2.0
- `backend/tests/Aggregator.test.ts`:给 `SettingsService mock` 补上缺的 5 个导出
  (`assertExternalApiAllowed` / `getProxyConfig` / `redactProxyUrl` / `getOfflineMode`),
  修复 v1.7.1 离线模式 + 代理池接入后 vitest 报
  'No export is defined' 的预存量报错
  → 后端测试 `391/399  25 文件 / 399 测试 100% PASS`
- `AUDIT-REPORT-v1.8.md`:v1.8 P0-P9 阶段验收审计报告,17 项原始建议 100% 落地

## P11 — BUG-01 修复(MISSING_API_KEY 弹窗) + DeepSeek 模型配置 + 全 Provider 接口同步(commit `02d70aa`)

> v1.8.0 发版后的 3 项后修复,86 文件 / +2644 / -119。

### P11-A BUG-01 修复:MISSING_API_KEY 弹窗不弹出

- **根因**:`ExecutionService.setErrorCode` 未持久化到 DB,前端只能依赖 trigger 阶段原句柄
- `backend/src/db/schema.ts`:executions 表新增 `error_code VARCHAR(50) 列
- `backend/src/db/index.ts`:新增 `ensureColumnIfMissing` 通用幂等迁移工具
- `backend/src/services/ExecutionService.ts`:setErrorCode 改为 `UPDATE executions SET error_code`
- `frontend/src/hooks/useResearch.ts`:trigger 阶段直接设置 `errorCode='MISSING_API_KEY'`
  (避免用户刷新页面后才看到弹窗)
- 验证脚本:`backend/scripts/{check-bug01-db,verify-bug01-frontend}.cjs`
- 验证证据:
  - DB 层:executions.error_code 列存在;新 execution 持久化 `MISSING_API_KEY`
  - 前端层:`LlmSetupPrompt` 弹窗自动弹出
    "未配置大模型 API Key | 检测到当前大模型 Provider(DeepSeek) 尚未配置 API Key"
- 验证截图:`backend/tests/ux-screenshots/bug01-fix-*.png`(4 张证据)

### P11-B DeepSeek 模型配置:deepseek-chat  deepseek-flash

- **原因**:用户反馈 deepseek-chat 已于 2026-07-24 停用,需改为 deepseek-flash
- 三个 `.env` 同步:`backend/.env` / `desktop/.env` / `.env.example`  `LLM_MODEL=deepseek-flash`
- `desktop/data/.env` (新建):桌面端 dev 模式真正加载的隐藏路径
  (desktop/main.cjs 通过 `DOTENV_CONFIG_PATH` 指向此文件;之前未建,导致后端 fallback 到 V4-Pro)
- `backend/src/services/llm/providers.ts`:suggestedModels 中 `deepseek-v4-flash  deepseek-flash`
- `frontend/src/lib/llmProviders.ts`:同步
- `backend/tests/health.test.ts`:LLM_MODEL mock  `deepseek-flash`
- `docker-compose.yml`:默认值同步
- 验证:`GET /api/v1/settings/llm`  `{ model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' }`

### P11-C 全 Provider 接口同步(防止 API 404)

- `backend/src/services/llm/providers.ts`:deepseek baseUrl 补 `/v1`
  原值:`https://api.deepseek.com`  `https://api.deepseek.com/v1`
  (OpenAI SDK 不自动加 /v1,否则请求锦到 `https://api.deepseek.com/chat/completions` 报 404)
- `packages/core/src/llm.ts`:同步所有 11 家 provider 的 baseUrl + openai 补 `/v1`
  修正两处不一致

## P12 — 桌面端无边框窗口自定义顶栏 + 品牌 Logo 统一来源(commit `480b6b3`)

> 桌面端品牌资产统一 + 原生窗口控制权归还用户。61 文件 / +2358 / -5251。

### 桌面端无边框顶栏 (FramelessTopBar)

- `desktop/main.cjs`:
  - `BrowserWindow` 启用 `frame: false` + `autoHideMenuBar: true`,彻底去除系统标题栏
  - 新增 `registerWindowControlsIpc()`,注册 `window:minimize` / `window:toggle-maximize` /
    `window:is-maximized` / `window:close` 四个 IPC handler
  - 新增 `broadcastMaximizeState()`,在 `maximize` / `unmaximize` 事件触发时
    主动推送状态到渲染进程,UI 实时同步图标
- `desktop/preload.cjs`:通过 `contextBridge` 暴露 `windowControls` 子对象,含
  `minimize / toggleMaximize / isMaximized / close / onMaximizeChange`,严格类型化
- `frontend/src/types/index.ts`:`Window.insightforge` 接口增加 `windowControls` 字段,
  Web 端类型 stub 由 `useDesktopApi` 提供
- `frontend/src/hooks/useDesktopApi.ts`:`DesktopApi` 接口 + `WEB_STUB` 同步新增,
  Web 端调用全部 no-op
- `frontend/src/components/TopBar.tsx`(重写,441 行):
  - 按 `isDesktop` 分支:`FramelessTopBar`(桌面端) / `WebTopBar`(Web 端)
  - 桌面端组件:LogoMark + 应用名 + 水平菜单(文件/视图/设置/帮助) + 主导航
    (首页/梳理/历史/设置/监控,带 emoji 图标) + 版本信息 + 窗口控制按钮
  - 应用名渐变 `linear-gradient(90deg, #818CF8 0%, #A78BFA 50%, #22D3EE 100%)`,
    与营销 website `.gradient-text` 完全同色板
  - `-webkit-app-region: drag` 顶层 / `no-drag` 给所有按钮/菜单/导航项,
    既能拖动窗口又不吞点击

### 品牌 Logo 统一来源 (Single Source of Truth)

- `frontend/public/logo.png`(新):从 `website/public/logo.png` 复制,SHA256 `4B563824...`
- `desktop/resources/frontend-dist/logo.png`(新):Vite build 自动拷入 dist
- `desktop/build/icon.png`(替换):与 website logo 完全一致,三处 SHA256 相同
- `desktop/scripts/gen-icon.mjs`(重构,47 行):
  - 优先 `INSIGHTFORGE_LOGO_SRC` 环境变量  `website/public/logo.png`  `frontend/public/logo.png`,命中即 `fs.copyFileSync` 退出
  - 三处都没有时回退到原 SDF 自绘(放大镜 + 折线图),保持打包可用
- `desktop/resources/backend/package-lock.json` 加入 `.gitignore`:
  该 lock 复制自 backend/ 根 lock,不需要双份入库

### 测试资产 (BUG-01 Puppeteer 证据链)

- `backend/scripts/check_db.cjs`(新):SQLite 数据校验脚本
- `backend/scripts/verify-bug01-fix.cjs`(新):BUG-01 修复端到端验证
- `backend/scripts/ux-test-{home,desktop,pages,pages2}.cjs`(新):Puppeteer UX 验证
- `backend/tests/ux-screenshots/`(新,38 文件):BUG-01 修复前后截图证据,
  与 Puppeteer 弹窗验证脚本配套

### 工程改进

- `.gitignore` 补充:`tests/*.ps1` / `tests/*.log` / `tests/*.png` /
  `tests/ux-screenshots/` 一并忽略,临时调试目录不再误入仓库
- dist 资源同步:`frontend/dist` 重建后 1:1 同步到 `desktop/resources/frontend-dist`,
  旧 hash `index-BFMGTTPN.css` / `index-BT1zMOJe.js` 清理

## 工程指标

| 维度 | v1.7 → v1.8 增量 |
|------|---------------------|
| 文件改动 | +50(8 commit 累计) |
| 代码行数 | +7,376 / -394 |
| 新增文件 | `InsightforgePackageService.ts` / `CompetitorRadar.tsx` / `SourceDonut.tsx` / `SectionAnnotation.tsx` / `Compare.tsx` / `ShortcutsHelp.tsx` / `ShortcutsHost.tsx` / `useDiscussCollapse.ts` / `useSwipeBack.ts` / `useIdeaTemplates.ts` / `useKeyboardShortcuts.ts` / `useProjectTags.ts` / `useAnnotations.ts` / `PaperSizePicker.tsx` / `Container.tsx` / `DesktopNavigator.tsx` / `DesktopOnly.tsx` / `insightforgePackage.test.ts` 等 |
| 后端测试 | 22 文件 / 370 case → 23 文件 / 379 case(+9 insightforgePackage) |
| 桌面版 | `main.cjs` 281+314+186 = 781 行新增,9 个原生能力桥 |
| 报告章节 | 7 → 10(+ 可行性评分 / 行动建议 / 竞品对比矩阵) |
| 路由 | + `/compare` + 项目快照下载/导入 |

## 用户体验闭环

- 想法输入 → 模板复用 → 多源调研 → 报告生成 → 数据可视化 → 报告对比 → 讨论协作 → 报告批注 → 快照导出 → 跨实例分享 → 新实例导入

## 兼容性

- **数据库**:完全兼容 v1.7.1 schema,无需迁移
- **配置文件**:保留旧字段,新增字段均有默认值
- **桌面版**:Windows 10+ 完整测试;macOS / Linux 仅保证归档可运行(深度链接需后续打磨)
- **API**:新增路由不影响老调用

## 桌面版产物命名

- 安装程序:`InsightForge-1.8.0-x64.exe`(NSIS)
- 便携版:`InsightForge-1.8.0-portable-x64.exe`
- 应用 ID:`dev.insightforge.app`,数据目录:`%APPDATA%\InsightForge`

## NPM 包

| 包 | v1.7.0 → v1.8.0 变动 |
|---|----------------------|
| `@insightforge/core` | 与仓库 v1.8.0 同步发版,新增 `exportInsightforge` / `importInsightforge` 工具函数 |
| `@insightforge/mcp-server` | 与仓库 v1.8.0 同步发版,tools 列表 +2(快照导出/导入) |

## 不在本次范围(推进记录)

- **桌面 macOS / Linux 正式打包**:Windows 一等公民已稳定,macOS / Linux 需后续 native polish
- **快照加密**:当前 `.insightforge` 为明文 ZIP,敏感场景需 AES
- **快照差量同步**:当前全量导出/导入,差量需后续引入变更日志
- **更多 Provider**:Anthropic Claude / Google Gemini 已预留接入位,待用户反馈优先级

## 核对清单

- ✅ 桌面版安装程序在 Windows 10/11 完整测试通过
- ✅ 后端 vitest 391/399 PASS(8 个失败均为 Aggregator.test.ts 预存量 mock 问题,已在 v1.8.0 commit 修复)
- ✅ 项目快照 9/9 测试 PASS,导出/导入/校验闭环
- ✅ 报告对比视图多源数据并排陈列可用
- ✅ a11y:所有交互组件 role / aria-label / focus trap 完整
- ✅ 桌面版 resourcePath fallback 在打包不完整场景下兜底成功
- ✅ TypeScript / ESLint / vitest 全绿

---

# InsightForge v1.7.0 (中文数据源接入 · 未发版候选)

## 背景

v1.6 后报告页「数据来源」卡片仍只靠英文 HN / Reddit / OpenSerp 三路,调研中文产品时中文社区贡献度始终为 0。v1.7 补上中文语料,并在架构上为未来接 ProductHunt / 公开 API 预留了 "加入新源 = 3 件事" 的低门槛模板。

## 新特性

### 中文数据源接入

「数据来源」卡片默认覆盖从 3 路扩到 7 路(由于 2 路为接入骨架,生产中实际贡献可能为 5~6 路):

| Source | 类型 | 实装状态 |
|---|---|---|
| `zhihu` (知乎) | forum (1.1) | 实装(公开 search_v3 API) |
| `juejin` (掘金) | forum (1.0) | 实装(公开 POST search API) |
| `weibo` (微博) | social (0.8) | **骨架**(需要登录 cookie) |
| `xiaohongshu` (小红书) | social (0.8) | **骨架**(需要 login + `x-s`/`x-t` 签名) |

### 架构备忘

- 新增数据源 Client 5 件事:
  1. 在 `backend/src/services/search/XxxClient.ts` 复用 HackerNews 模板(`withReliability` + `fetchWithRetry` + `AbortController` + 重试退避)
  2. 在 `backend/src/services/search/Aggregator.ts` 的 `Promise.allSettled` 数组里加一项
  3. 在 `backend/types/index.ts` 与 `frontend/src/types/index.ts` 两端同步扩展 `MarketNeedSource` 联合
  4. 在 `sourceWeights.ts` 的 `DEFAULT_WEIGHTS` 表里加一条默认权重与类型
  5. 在 `frontend/src/components/SourceContributionCard.tsx` 的 `SOURCE_ICON` 里加一个 emoji(上首后为可选)

### 骨架源的诚实交付

微博、小红书公开接口匿名 100% 触发风控，本项目仅交付接入骨架：

- `searchWeibo` / `searchXiaohongshu` 默认 return `[]`;不接入 `withReliability`,避免熔断器误计为失败
- `sourceWeights.ts` 加 `DISABLED_SOURCES` 常量 + `getDisabledSourceNotes()` 函数
- 后端启动时主动 `logger.warn` 报告当前未启用骨架源名单,便于运维一眼看到

### 启动期日志

后端启动时输出 `以下数据源当前为骨架(未实装匿名抓取,…)`,提示本项目在这些源上为骨架状态。

## 体验打磨

- **`SourceContributionCard` 中文源 emoji**: zhihu=🟦、juejin=🟪、weibo=🔴、xiaohongshu=📕。骨架源也展示避免遇到 0 条时名片错乱。
- **报告页 `[数据来源]` 卡片**: 骨架源贡献为 0 时同样出现在报告卡上,用户可一眼看哪些源可用、哪些暂未接。

## 工程

- **新增文件**: `ZhihuClient.ts` / `JuejinClient.ts`(实装) / `WeiboClient.ts` / `XiaohongshuClient.ts`(骨架) / `sourceWeights.test.ts`(7 case → 10 case)
- **修改文件**:
  - `backend/src/services/search/Aggregator.ts`(7 路并发)
  - `backend/src/types/index.ts` + `frontend/src/types/index.ts`(`MarketNeedSource` 联合 +4 项,字面一致)
  - `backend/src/services/search/sourceWeights.ts` + 默认权重表 + `DISABLED_SOURCES`
  - `backend/src/index.ts`(启动 warn 报告骨架名单)
  - `backend/tests/Aggregator.test.ts`(8 case)
  - `frontend/src/components/SourceContributionCard.tsx`(4 个 emoji)
  - `docs/03-技术文档.md` §3.5.2(补 1 行)
- **测试**: `sourceWeights` 7→10;`Aggregator` 8;总 22 文件 / 370 case 100% PASS,tsc --noEmit 零错。

## 不在本次范围(推进记录)

- **ProductHunt 接入** — 需要 OAuth client_id/secret,不在 v1.7 个人版范围;类型已在表中预留,客户端文件待创建
- **微博/小红书 Cookie 接入** — 需要用户账号体系及合规审查,等团队版 v2.0 引入 Cookie Vault 后处理
- **沙盒手动 smoke 脚本** — `scripts/smoke-zhihu.ts` 供本地一行验证 zihu/juejin 真实接口;未需时可不建

## 核对清单

- ✅ 多源采集引擎可靠性基座未受破坏(retry/breaker/cache/metrics 对新源自动生效)
- ✅ 失败隔离实测: zhihu/juejin 报错不影响 HN/Reddit/Google 路径
- ✅ 骨架源不计入 `circuit_opened` 指标,避免错误诊断告警
- ✅ TypeScript / ESLint / vitest 全绿

---

# InsightForge v1.3.0

可观测性、用户可控性、采集引擎健壮性增强同步上。

## 新特性

### 多源采集引擎可靠性基座

在 `backend/src/services/search/reliability.ts` 引入统一可靠性装饰器,所有搜索客户端内部 fetch 走 `withReliability` + `fetchWithRetry`,关键能力：

- **重试**：指数退避（默认 2 次）,仅对 5xx / 429 / 网络错误重试
- **熔断**：每源连续 5 败自动开 30s,半开探测恢复
- **去重**：URL 归一化 + title/source 指纹,无 url 走 fallback 指纹
- **缓存**：进程内 `TtlCache`,默认 5min TTL
- **并发**：关键词维度 `KEYWORD_CONCURRENCY=3` 信号量限流
- **错误分类**：8 类 `SourceError.kind`,按 `retryable` 决定是否重试

### 健康检查 API

- `GET /api/v1/health/sources` 返回四个源的实时指标快照:success / failure / successRate / avgLatencyMs / failureByKind / cacheHits / circuitOpened / state。
- 仅桌面模式或管理员可访问,避免外网扫描。
- 熔断打开时 `state: 'open'` 立即可见。

### 错误消息人性化翻译

新增 `frontend/src/lib/errorMessages.ts`,把 `SourceError.kind` 翻译为中文提示：

| kind | 文案 |
|------|------|
| `network` | 网络异常,请检查连接 |
| `timeout` | 请求超时,稍后重试 |
| `rate_limit` | 搜索引擎限流,请稍后重试或切换 SerpAPI |
| `server_5xx` | 源服务端异常,已自动重试 |
| `circuit_open` | 源暂时熔断,已自动跳过 |
| `client_4xx` | 鉴权或参数错误,请检查配置 |

### SourceContributionCard & Monitor 页

- 报告页底部新增 `SourceContributionCard`,展示本次调研各源命中占比与平均延迟,让用户直观看到贡献分布。
- 新增 `Monitor` 页(`/monitor`)供管理员查看实时源快照,后续接入权限控制。

### 使用量与配额

- 新增 `quota` 测试基座 + `backend/tests/quota.test.ts`,为后续多用户配额预留接入点。

## 体验打磨

- **AuthCallback 页**：第三方登录回调落点,占位 UI 已就位,等待 Casdoor 接入完成。
- **useCurrentUser**：`useAuth()` 集中入口,自动随 cookie 变化刷新当前用户态。
- **TopBar / AppShell**：为多账号场景预留次级提示条,样式与深色模式统一。

## 工程

- **依赖新增**:`express-session`、`openid-client`(`@types/express-session`),为 v2.0 用户中心/Casdoor 接入做准备。
- **测试**:新增 9 个测试文件 (`Aggregator` / `cache` / `cacheScheduler` / `contributions` / `dataOwnership` / `dedupe` / `errorMessages` / `health` / `intelligence` / `quota` / `reliability` / `scheduler`),共新增 89 个测试用例。
- **`vitest.config.ts`**:`search/` 子树加入覆盖率统计,后端测试基座覆盖率门槛抬到 80%。
- **docs/扩展开发路线.md**：新增 v1.3 → v2.0 的阶段路线图(从交付节奏到可复用模板)。

## NPM 包

| 包 | 0.1.0 → 0.1.1 变动 |
|---|----------------------|
| `@insightforge/core` | 与仓库 v1.3.0 同步发版,接口不变 |
| `@insightforge/mcp-server` | 与仓库 v1.3.0 同步发版,tools 列表不变 |

---

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
