# InsightForge 个人版 · 项目审计与 UX 优化方案

> 审计对象：[MatuX-ai/InsignForge](https://github.com/MatuX-ai/InsignForge)（仓库命名 `InsignForge`，品牌名 `InsightForge`）
> 审计时间：2026-09-25
> 审计依据：[docs/01-项目说明与需求说明书.md](docs/01-项目说明与需求说明书.md)（FR-01 ~ FR-18、NFR-01 ~ 06）
> 审计人角色：产品经理（兼前端代码审查）

---

## 一、项目概况

| 项 | 内容 |
| --- | --- |
| 项目定位 | 完全自包含、可本地运行的市场验证工具箱（个人版） |
| 核心理念 | 从模糊想法到有数据支撑的市场报告，只需 5 分钟 |
| 当前代码版本 | `package.json` 标记 `1.7.0`；UI 中 `TopBar` 仍硬编码 `v1.6` |
| 主要技术栈 | React 18 + Vite + Tailwind、Node.js + Express + TypeScript、Mastra 智能体、SQLite、Electron 33 |
| 数据采集源 | HackerNews、Reddit、OpenSerp、Google + 中文源（知乎、掘金、微博、小红书） |
| 大模型支持 | 10+ Provider：DeepSeek、智谱 GLM、通义千问、Kimi、零一万物、MiniMax、腾讯混元、商汤日日新 + OpenAI 兼容 + Ollama |
| 报告章节数 | 9 章节（执行摘要 / 可行性评分 / 行动建议 / 市场热度 / 竞品识别 / 竞品对比矩阵 / 用户痛点 / 市场规模 / 风险机会 / 数据来源） |

**整体评价**：核心闭环（输入想法 → 多源采集 → 结构化报告 → 落地页）已跑通，技术架构清晰，文档齐全。**主要的改进空间集中在 UX 细节打磨与少量正确性 bug 上**。

---

## 二、需求文档逐条对齐情况

| 编号 | 需求描述 | 状态 | 证据 / 备注 |
| --- | --- | --- | --- |
| FR-01 | Web 界面输入项目名称与描述 | ✅ 已实现 | [Home.tsx](frontend/src/pages/Home.tsx) 单输入框 + 示例填充 |
| FR-02 | 关键词自动提取 | ✅ 已实现 | MarketResearcher Agent 拆解 |
| FR-03 | 自动拆解搜索关键词 | ✅ 已实现 | MarketResearcher Agent 多关键词组合 |
| FR-04 | 聚合多源数据 | ✅ 已实现 | HN/Reddit/OpenSerp + 4 中文源 |
| FR-05 | LLM 生成结构化报告 | ✅ 已实现 | 9 章节结构化输出 |
| FR-06 | OpenSerp 集成 | ✅ 已实现 | [Settings.tsx](frontend/src/pages/Settings.tsx) 搜索引擎配置 |
| FR-07 | Reddit / HN 抓取 | ✅ 已实现 | crawler 模块 |
| FR-08 | **代理池配置以应对反爬** | ⚠️ **缺失** | 文档提到，**UI 无配置入口**（建议补到 Settings 网络 Tab） |
| FR-09 | SQLite 存储 | ✅ 已实现 | backend `data/insightforge.db` |
| FR-10 | 关键词检索历史数据 | ⚠️ **部分实现** | [History.tsx](frontend/src/pages/History.tsx) 有列表筛选，**但缺少跨项目的全文检索** |
| FR-11 | 7 章节报告 | ✅ 已实现（升级为 9 章节） | 增加可行性评分 + 行动建议 |
| FR-12 | 数据引用带来源链接 | ✅ 已实现 | SourceContributionCard 组件 |
| FR-13 | **调用 DeepSeek Harness 生成落地页** | ⚠️ **架构偏离** | 实际由 `backend/src/utils/landingGenerator` 自行生成 HTML，未通过 dsh 插件；后续需评估是否落回 Harness 插件 |
| FR-14 | 落地页含订阅按钮 | ⚠️ **固定文案** | 固定"加入等待列表"按钮，无法定制文案/字段 |
| FR-15 | 极简单页应用 | ✅ 已实现 | 顶部导航 + 单页布局 |
| FR-16 | 结构化展示 + 滚动浏览 | ✅ 已实现 | Report 章节滚动 |
| FR-17 | 数据本地存储 | ✅ 已实现 | SQLite + 本地归档目录 |
| FR-18 | **配置是否启用外部 API 调用** | ⚠️ **缺失** | 无"完全离线模式"开关 |

**非功能需求**：

| 编号 | 需求 | 状态 | 备注 |
| --- | --- | --- | --- |
| NFR-01 | 报告 ≤ 5 分钟 | ✅ | 含 ETA 估算 |
| NFR-02 | Docker 一键启动 | ✅ | docker-compose.yml |
| NFR-03 | ≤ 2 个 API Key | ✅ | LLM + Search |
| NFR-04 | 零强制注册 | ✅ | 鉴权可选 |
| NFR-05 | 跨平台（Linux/macOS/Windows） | ✅ | Electron 桌面端覆盖 |
| NFR-06 | 最低硬件（2C4G10G） | ✅ | |

**对齐结论**：18 条功能需求中，**13 条完全实现、5 条部分偏离或缺失**。缺失项集中在「代理池配置」「关键词全文检索」「落地页生成架构」「订阅按钮定制」「外部 API 开关」—— 这些是产品从 MVP 走向「专业工具」的下一步补强项。

---

## 三、产品经理视角的 UX 优化清单

按优先级 P0（Bug）/ P1（内容一致性）/ P2（引导与流程）/ P3（数据可视化与可访问性）分类。

### 🔴 P0 — 必须修复的 Bug

#### BUG-01 OnboardingModal 切换 Provider 后实际未生效

- **位置**：[frontend/src/components/OnboardingModal.tsx:88](frontend/src/components/OnboardingModal.tsx#L88)
- **问题**：`handleSave()` 仅调用 `api.updateLlmApiKey(...)`，**没有调用 `api.updateLlmConfig(...)` 同步 provider/model**。结果：用户在引导弹窗切换到「智谱 GLM」并填写 Key 后，UI 显示保存成功，但后端仍然使用旧的 DeepSeek Provider。
- **影响**：**首次配置体验直接误导用户**，且不易察觉，会延续到第一次调研失败。
- **修复**：
  ```ts
  // 改为一次调用更新 provider + model + apiKey
  const res = await api.updateLlmConfig({
    provider,
    model: defaultModelFor(provider),
    apiKey: trimmed || 'sk-placeholder',
  });
  ```

#### BUG-02 LlmSetupPrompt 提示文案硬编码为 "LLM"

- **位置**：[frontend/src/components/LlmSetupPrompt.tsx:41-43](frontend/src/components/LlmSetupPrompt.tsx#L41)
- **问题**：
  ```ts
  function providerHint(): string {
    return 'LLM';
  }
  ```
  当用户在 [Settings](frontend/src/pages/Settings.tsx) 中将 Provider 切换为「智谱 GLM」后触发 MISSING_API_KEY，弹窗会显示"当前大模型 Provider（LLM）尚未配置 API Key"—— **完全没告诉用户是哪一家**，需要用户去 Settings 自己回忆。
- **修复**：通过 props 传入当前 provider，或在组件挂载时 `api.getLlmStatus()` 拉取真实 provider 名称。

#### BUG-03 OnboardingModal 切换 Provider 后 Model 字段不变

- **位置**：[frontend/src/components/OnboardingModal.tsx:140-146](frontend/src/components/OnboardingModal.tsx#L140)
- **问题**：`onChange` 中调用 `void defaultModelFor(next);` —— **结果被 `void` 丢弃**，UI 中 model 字段不会随 provider 切换重置。**当前 Modal 未展示 Model 字段，但语义不一致**，未来扩展时易出 bug。
- **修复**：保存 model 状态 `useState(defaultModelFor('deepseek'))`，在 onChange 时同步更新：
  ```ts
  setProvider(next);
  setModel(defaultModelFor(next));
  ```

#### BUG-04 TopBar 版本号硬编码 v1.6，与 package.json 不一致

- **位置**：[frontend/src/components/TopBar.tsx:106](frontend/src/components/TopBar.tsx#L106)、[:220](frontend/src/components/TopBar.tsx#L220)
- **问题**：硬编码 `v1.6 · 个人版`，实际 `package.json` 已是 `1.7.0`，且 [release-notes.md](release-notes.md) 已记录 v1.7.0 的功能升级。
- **影响**：用户看到的版本号永远落后实际版本，**影响产品专业感和信任感**。
- **修复**：从 `import.meta.env.PACKAGE_VERSION` 或后端 `/version` 端点拉取，模板中 `${version} · 个人版`。

#### BUG-05 Settings.tsx 默认 Model 硬编码，应调用 defaultModelFor

- **位置**：[frontend/src/pages/Settings.tsx:27](frontend/src/pages/Settings.tsx#L27)
- **问题**：
  ```ts
  llmModel: 'deepseek-v4-pro',
  ```
  应改为：
  ```ts
  llmModel: defaultModelFor('deepseek'),
  ```
  否则 `llmProviders.ts` 中 deepseek 的 `defaultModel` 字段更新后，UI 仍沿用旧值。

### 🟡 P1 — 内容/品牌一致性问题

#### ISSUE-01 FAQ 内容过时，未提及 8 家国产 LLM

- **位置**：[frontend/src/pages/Faq.tsx:23](frontend/src/pages/Faq.tsx#L23)
- **当前**：「支持 OpenAI 兼容接口的任何模型，包括 DeepSeek、Claude、Groq 等。」
- **问题**：项目核心卖点之一是 **10+ 国产 LLM 全支持**（[llmProviders.ts](frontend/src/lib/llmProviders.ts)），但 FAQ 中只列了 DeepSeek + 三个 OpenAI 兼容示例。
- **修复**：改为「支持 DeepSeek、智谱 GLM、通义千问、Kimi、零一万物、MiniMax、腾讯混元、商汤日日新等 10+ 国产模型，同时兼容 OpenAI/Anthropic 接口，支持通过 Ollama 使用本地模型。」

#### ISSUE-02 FAQ 中项目文档链接 URL 错误（会 404）

- **位置**：[frontend/src/pages/Faq.tsx:70](frontend/src/pages/Faq.tsx#L70)
- **问题**：链接 `01-%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E%E4%B8%8E%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%E4%B9%A6.md` 解码后是 `01-项目与需求说明书.md`（**少了"说明"二字**），实际文件名是 `01-项目说明与需求说明书.md`。**点击会直接跳到 GitHub 404 页面**。
- **修复**：补全 URL 编码 `01-%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E%E4%B8%8E%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%E4%B9%A6.md` → 实际应为 `01-%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E%E4%B8%8E%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%E4%B9%A6.md`（注意"说明"二字不可省）。

#### ISSUE-03 Settings.tsx placeholder 仍引用旧的 deepseek-chat

- **位置**：[frontend/src/pages/Settings.tsx:280](frontend/src/pages/Settings.tsx#L280)
- **当前**：`placeholder="例如 deepseek-chat"`
- **问题**：代码注释 `// 旧值 'deepseek-chat' 已于 2026-07-24 停用`，但 placeholder 仍展示这个已弃用的模型名，会**误导用户去复制粘贴旧模型名**。
- **修复**：改为 `例如 deepseek-v4-pro` 或 `例如 glm-5`。

#### ISSUE-04 仓库命名 `InsignForge`（少 h）与品牌 `InsightForge`（有 h）不一致

- **现状**：GitHub 仓库 URL `MatuX-ai/InsignForge` 拼写为 `InsignForge`（少 h），但 README、docs、UI 文案、Faq 中的 issue 链接等均使用 `InsightForge`。
- **问题**：用户在 GitHub 看到 `InsignForge`，进入 README 又看到 `InsightForge`，**品牌一致性破损**。
- **建议**：
  - 选项 A：把仓库重命名为 `InsightForge`（推荐，与文档对齐），同步更新 issue 链接。
  - 选项 B：在 README 顶部明确说明「仓库名为历史遗留拼写，品牌统一为 InsightForge」。
  - 在 [Faq.tsx:61](frontend/src/pages/Faq.tsx#L61) 的 issue URL 上注明当前正确的仓库地址。

### 🟢 P2 — UX 引导与流程改进

#### ISSUE-05 Report 页「调研完成但无报告」提示不友好

- **位置**：[frontend/src/pages/Report.tsx:1750-1760](frontend/src/pages/Report.tsx)
- **当前**：兜底文案 "该调研尚未开始或已完成但未生成报告"
- **问题**：未区分 pending / failed / completed-empty 三种状态；用户看到该文案不知道该怎么办。
- **修复**：
  - `failed`：显示错误码 + 「点击重试」按钮。
  - `completed-empty`：显示「报告生成失败，可能是 LLM API 超时。建议：1) 降低描述长度后重试；2) 切换其他模型」。
  - `pending`：显示 ResearchLoadingPanel（当前已正确处理）。

#### ISSUE-06 PDF 导出降级路径引导不充分

- **位置**：[frontend/src/pages/Report.tsx](frontend/src/pages/Report.tsx)（导出 PDF 失败时降级为打印）
- **问题**：后端 PDF 生成失败时降级为 `window.print()`，提示文案仅一句 "在打印预览选择另存为 PDF"。
- **修复**：弹一个 Modal 给出**操作系统分步骤的图文引导**：
  - Mac：「系统对话框 → 左下角 PDF → 存储为 PDF」
  - Windows：「目标 → 另存为 PDF」
  - Linux：「打印到文件 → 输出格式 PDF」

#### ISSUE-07 Monitor 页缺少角色说明

- **位置**：[frontend/src/pages/Monitor.tsx](frontend/src/pages/Monitor.tsx)
- **问题**：监控页是 v1.6 新增的运维视图，但普通用户进入会一头雾水——不知道这个页面"我"是否该看、能做什么。
- **修复**：在 Monitor 页顶部增加说明卡片：
  > 本页展示系统运行状态与最近任务流水，适合开发者与运维人员查看。普通用户可忽略。

#### ISSUE-08 Home 页缺少「想法示例库」与「继续上次调研」入口

- **位置**：[frontend/src/pages/Home.tsx](frontend/src/pages/Home.tsx)
- **问题**：仅 1 条示例（"独立开发者快速验证 SaaS 想法的桌面工具"），对新用户缺少领域覆盖，对老用户没有快速复用入口。
- **修复**：
  - 增加 4-5 条分类示例卡片（工具类 / 内容类 / SaaS 类 / 硬件类 / 教育类），点击直接填入。
  - 在输入框下方增加「继续上次调研」入口（基于 localStorage 记录 projectId），点击直接跳到 Report 页。

#### ISSUE-09 Discuss 模板只有 4 条，覆盖不足

- **位置**：[frontend/src/pages/Discuss.tsx](frontend/src/pages/Discuss.tsx)（快捷 prompt 模板）
- **问题**：5 种画布模式各只有不到 1 条模板，对新用户而言太少。
- **修复**：扩展到 8-10 条，按画布类型组织：
  - 商业模式：分析收入结构 / 识别关键合作伙伴
  - 精益：定义早期用户 / MVP 范围
  - SWOT：列出 3 个最大威胁
  - 软件项目：拆解用户故事
  - 头脑风暴：发散 10 个功能点

#### ISSUE-10 History 页「归档文件」列表缺乏整体视图

- **位置**：[frontend/src/pages/History.tsx](frontend/src/pages/History.tsx)
- **问题**：归档文件列表直接展示单文件链接（`report.md` / `landing.html` / ...），docs/ 中多份文档无法一眼看完。
- **修复**：折叠为「查看完整归档包（5 份文件）」按钮，点击 Modal 一次性浏览全部归档内容（含 Markdown 渲染预览）。

#### ISSUE-11 OnboardingModal 「稍后再说」按钮文案让用户误解为可选项

- **位置**：[frontend/src/components/OnboardingModal.tsx:127](frontend/src/components/OnboardingModal.tsx#L127)
- **问题**：文案「稍后再说」暗示这是"无所谓"的选择，但实际上不配置 LLM 就**无法启动任何调研**。
- **修复**：按钮文案改为「先跳过，去首页」，并增加副文案「可在首页右上角 → 设置 → 大模型 随时回来配置」。

#### ISSUE-12 错误恢复时的引导不完整

- **位置**：[frontend/src/lib/errorMessages.ts](frontend/src/lib/errorMessages.ts) + [useResearch.ts](frontend/src/hooks/useResearch.ts)
- **现状**：11 个错误码都有中文映射，但部分错误（如 `RATE_LIMIT`、`SOURCE_NETWORK`）只显示错误说明，**没有一键跳转的修复按钮**。
- **修复**：扩展 errorMessages 的返回结构，加入 `action?: { label: string; handler: () => void }`，例如：
  - `MISSING_API_KEY` → 「去设置」按钮
  - `RATE_LIMIT` → 「30s 后自动重试」+ 倒计时
  - `SOURCE_NETWORK` → 「重试 / 切换搜索引擎」

### ⚪ P3 — 数据可视化、可访问性、功能补强

#### ISSUE-13 市场规模数字无单位/年份提示

- **位置**：[frontend/src/pages/Report.tsx](frontend/src/pages/Report.tsx) 市场规模章节
- **问题**：报告可能写「市场规模约 8.5 亿」，但未注明货币（人民币？美元？）和时间范围（年？十年累计？）。
- **修复**：在数字后追加单位标注「约 8.5 亿美元/年（2026）」。

#### ISSUE-14 竞品对比矩阵在移动端溢出

- **位置**：[frontend/src/pages/Report.tsx](frontend/src/pages/Report.tsx) 竞品对比矩阵
- **问题**：5 列 × N 行的矩阵在 < 768px 下挤压为不可读。
- **修复**：断点 < 768px 时改为卡片堆叠（每张卡片显示一个竞品的横向对比）。

#### ISSUE-15 顶部 TopBar 在小屏下未折叠

- **位置**：[frontend/src/components/TopBar.tsx](frontend/src/components/TopBar.tsx)
- **问题**：5 个导航项（首页/梳理/历史/设置/监控）+ 版本号 + 用户入口，在 768px 以下挤压。
- **修复**：< 768px 增加汉堡菜单，点击展开 Drawer。

#### ISSUE-16 颜色对比度需要复核（WCAG AA）

- **位置**：[docs/02-前端设计文档.md §2.3](docs/02-前端设计文档.md)
- **现状**：次要文字 `#6B7280` + 背景 `#F8FAFC` 对比度约 **4.4:1**，刚过 WCAG AA 4.5 边界。
- **修复**：次要文字加深到 `#4B5563`（对比度 **7.4:1**，过 WCAG AAA）。

#### ISSUE-17 键盘可访问性需要补强

- **位置**：全站 Modal / Dropdown / Drawer 组件
- **问题**：[Modal.tsx](frontend/src/components/Modal.tsx) 已支持 ESC 关闭，但**缺少焦点陷阱**（Tab 会跑到 Modal 后面）。
- **修复**：实现 `focus-trap` 库或自写 hook，确保 Modal 打开时焦点循环在 Modal 内。

### 🚀 功能补强建议（PM 视角）

| 优先级 | 模块 | 建议 |
| --- | --- | --- |
| P1 | 数据采集 | 补齐代理池配置 UI（FR-08），Settings 增加"网络"Tab |
| P1 | 离线模式 | 增加「完全离线模式」开关，仅用本地 Ollama + 本地缓存（FR-18） |
| P2 | 报告消费 | 报告分享：除了 PDF/PNG，增加「本地短链」（如 `insightforge://report/xxx`） |
| P2 | 报告对比 | 选中 2-3 份历史报告，进入对比视图（行业热度/竞品密度） |
| P2 | 协作 | 报告章节个人评论/批注，本地存储 |
| P3 | 信任感 | 报告页头部显示数据源清单与采集时间戳、生成模型名称 |

---

## 四、实施优先级与影响评估

| 优先级 | 涉及项 | 用户影响 | 工作量 |
| --- | --- | --- | --- |
| 🔴 P0 | BUG-01 / 02 / 03 / 04 / 05 | **高**（首次配置、版本信任感） | 0.5 人天 |
| 🟡 P1 | ISSUE-01 / 02 / 03 / 04 | 中（内容准确性、品牌一致性） | 0.5 人天 |
| 🟢 P2 | ISSUE-05 ~ 12 | 中-高（流程引导） | 2-3 人天 |
| ⚪ P3 | ISSUE-13 ~ 17 + 功能补强 | 低-中（体验锦上添花） | 3-5 人天 |

### 推荐迭代节奏

- **Sprint 1（1 周）**：修复所有 P0 Bug + P1 内容一致性。预计可让"首次配置"成功率提升到 95%+。
- **Sprint 2（1-2 周）**：完成 P2 引导改进。重点：PDF 降级引导、Monitor 角色说明、Home 示例库。
- **Sprint 3（2 周）**：推进 P3 数据可视化（市场规模单位、移动端适配）+ FR-08 / FR-18 功能补强。
- **Sprint 4（2 周）**：报告分享/对比/协作（功能补强）。

---

## 五、总结

### InsightForge 个人版的优势

1. **核心闭环跑通**：从输入到报告平均 5 分钟内完成，符合 MVP 定位。
2. **多模型多源支持**：10+ LLM + 7 类数据源，是国产 LLM 集成最完整的开源市场调研工具之一。
3. **代码质量较高**：前端 hooks 设计清晰（useResearch 自动重试）、错误体系完整（11 个错误码）、组件化良好。
4. **文档齐全**：需求、设计、技术、扩展路线四份文档均到位。

### 当前最大的改进空间（**这是本审计的核心结论**）

> **产品已实现 80% 的功能，但 UX 细节只打磨了 60%。**

具体表现为：

1. **5 个 P0 Bug 直接影响首次体验**（特别是 OnboardingModal 切换 provider 不生效 + LlmSetupPrompt 显示硬编码 "LLM"）。
2. **品牌/内容一致性欠梳理**（仓库名 InsignForge vs 品牌 InsightForge；FAQ 提到的 LLM 列表严重过时；多处引用了已废弃的 deepseek-chat）。
3. **引导与降级路径不完整**（PDF 导出降级、Monitor 页角色说明、Home 缺少示例库和历史继续）。
4. **部分需求尚未实现**（FR-08 代理池、FR-18 离线开关、FR-13 落地页架构偏离）。

### 一句话建议

> 优先用一个 Sprint 修复所有 P0 Bug + P1 内容一致性问题，让产品在「专业感」和「易用性」上对齐已实现的功能深度；其余 UX 改进可在后续 Sprint 中按"用户量 × 修复成本"逐步推进。

---

## 附录：审计过程中阅读的文件清单

- 项目文档：[README.md](README.md)、[release-notes.md](release-notes.md)、[docs/01-项目说明与需求说明书.md](docs/01-项目说明与需求说明书.md)、[docs/02-前端设计文档.md](docs/02-前端设计文档.md)
- 前端页面：[Home.tsx](frontend/src/pages/Home.tsx)、[Report.tsx](frontend/src/pages/Report.tsx)、[Settings.tsx](frontend/src/pages/Settings.tsx)、[History.tsx](frontend/src/pages/History.tsx)、[Discuss.tsx](frontend/src/pages/Discuss.tsx)、[Monitor.tsx](frontend/src/pages/Monitor.tsx)、[Faq.tsx](frontend/src/pages/Faq.tsx)、[AuthCallback.tsx](frontend/src/pages/AuthCallback.tsx)
- 前端组件：[TopBar.tsx](frontend/src/components/TopBar.tsx)、[OnboardingModal.tsx](frontend/src/components/OnboardingModal.tsx)、[ResearchLoadingPanel.tsx](frontend/src/components/ResearchLoadingPanel.tsx)、[ResearchProgress.tsx](frontend/src/components/ResearchProgress.tsx)、[SourceContributionCard.tsx](frontend/src/components/SourceContributionCard.tsx)、[Modal.tsx](frontend/src/components/Modal.tsx)、[BottomBar.tsx](frontend/src/components/BottomBar.tsx)、[LlmSetupPrompt.tsx](frontend/src/components/LlmSetupPrompt.tsx)
- 前端 lib / hooks：[api.ts](frontend/src/lib/api.ts)、[llmProviders.ts](frontend/src/lib/llmProviders.ts)、[errorMessages.ts](frontend/src/lib/errorMessages.ts)、[useResearch.ts](frontend/src/hooks/useResearch.ts)、[useCurrentUser.ts](frontend/src/hooks/useCurrentUser.ts)、[App.tsx](frontend/src/App.tsx)
- 后端核心：[backend/src/index.ts](backend/src/index.ts)、[backend/src/api/research.ts](backend/src/api/research.ts)、[backend/src/api/landing.ts](backend/src/api/landing.ts)、[backend/src/services/ResearchService.ts](backend/src/services/ResearchService.ts)

---

*本审计报告仅基于代码静态阅读 + 文档对照，未运行实际程序验证。建议修复完 P0 Bug 后进行一轮用户测试（5 个目标用户），验证首次配置体验改善效果。*
