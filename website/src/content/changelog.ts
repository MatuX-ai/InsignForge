/**
 * 更新日志 - 同步自 release-notes.md 与 desktop/build 流程
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  channel?: 'desktop' | 'web' | 'all';
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v1.0.2',
    date: '2026-08',
    title: '桌面版打包流水线修复',
    highlights: [
      '修复 electron-builder extraResources 白名单遗漏,NSIS 安装包正确包含后端 dist',
      '升级 better-sqlite3 prebuilt 至匹配 Electron 33 ABI 130',
      '桌面版首次启动 OnboardingModal 引导流程(未配置 API Key 时自动弹出)',
    ],
    channel: 'desktop',
  },
  {
    version: 'v1.0.1',
    date: '2026-07',
    title: 'MCP Server 与 dsh 插件 GA',
    highlights: [
      '@insightforge/mcp-server 上线,支持 Claude Desktop / Cursor 集成',
      '@insightforge/insightforge-dsh-plugin 上架 npm,DeepSeek Harness 用户可直接 npx 使用',
      '新增 4 个 MCP tools:market-research / search-demand / generate-landing / competitor',
    ],
    channel: 'all',
  },
  {
    version: 'v1.0.0',
    date: '2026-05',
    title: '首个公开版本',
    highlights: [
      '一句话输入 → 7 章节结构化市场报告(执行摘要 / 市场热度 / 竞品 / 痛点 / 规模 / 风险机会 / 数据来源)',
      '多源数据聚合:OpenSerp 搜索 + Reddit + Hacker News',
      'Docker Compose 一键部署;Electron 桌面版 NSIS 安装包/便携版',
      'Mastra 智能体编排(@mastra/core)',
      '生成验证落地页 HTML(支持 light/dark 主题)',
    ],
    channel: 'all',
  },
] as const;

export const ROADMAP: ChangelogEntry[] = [
  {
    version: 'v1.1',
    date: '2026 Q3',
    title: '数据可视化与导出增强',
    highlights: ['市场热度趋势图(Recharts)', 'Markdown / PDF 一键导出', '历史项目看板视图'],
  },
  {
    version: 'v1.2',
    date: '2026 Q4',
    title: '自定义数据源与本地模型',
    highlights: ['Ollama 深度集成(llama3 / qwen)', '插件化数据源(自定义 subreddit、关键词)', '本地 embedding + 语义去重'],
  },
  {
    version: 'v2.0',
    date: '2027 Q1',
    title: '团队版',
    highlights: ['Casdoor 多用户 + 权限管理', '团队共享需求库', '报告协作评论与版本对比', '企业级审计日志'],
  },
] as const;