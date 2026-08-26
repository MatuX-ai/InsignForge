/**
 * 核心特性列表 - Hero 区副标题与特性区共享数据
 */

export interface Feature {
  icon: string;
  title: string;
  description: string;
  highlight?: string;
}

export const FEATURES: Feature[] = [
  {
    icon: 'zap',
    title: '5 分钟拿到决策依据',
    description: '从一句话想法到 7 章节结构化市场报告,平均 2-5 分钟完成。本地需求库命中时 30 秒内出结果。',
    highlight: '效率',
  },
  {
    icon: 'shield',
    title: '完全本地化',
    description: '所有数据存储在本地 SQLite,无云依赖、无注册、无账号。代码 MIT 开源,可审计可迁移。',
    highlight: '隐私',
  },
  {
    icon: 'search',
    title: '多源数据聚合',
    description: '集成 OpenSerp 搜索引擎,自动从 Reddit、Hacker News 等社区抓取真实用户讨论,避免单源偏差。',
    highlight: '数据源',
  },
  {
    icon: 'bot',
    title: 'AI 智能体驱动',
    description: '基于 Mastra 框架的智能体自动拆解关键词、聚合数据、生成执行摘要、市场热度、竞品等结构化章节。',
    highlight: '智能',
  },
  {
    icon: 'package',
    title: '四渠道分发',
    description: 'Web 版(Docker)、桌面版(NSIS 安装包/便携版)、DeepSeek Harness 插件、MCP Server,按需选择。',
    highlight: '灵活',
  },
  {
    icon: 'plug',
    title: '模型可替换',
    description: '支持 DeepSeek、OpenAI、Claude、Groq 等 OpenAI 兼容接口,也可通过 Ollama 使用本地模型。',
    highlight: '开放',
  },
  {
    icon: 'file',
    title: '多格式导出',
    description: '报告支持 Markdown 与 PDF 导出,生成的验证落地页可独立 HTML 文件分享,适合假门测试。',
    highlight: '可分享',
  },
  {
    icon: 'code',
    title: '开发者友好',
    description: '完整 TypeScript SDK(@insightforge/core),可被其他工具链二次集成,提供 REST API 与 CLI。',
    highlight: '可扩展',
  },
] as const;