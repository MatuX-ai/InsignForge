/**
 * 站点级配置 - 所有外部链接、版本号、社交链接集中管理
 */

export const SITE = {
  name: 'InsightForge',
  tagline: '5 分钟把产品想法变成可决策的市场报告',
  description:
    '完全本地化、零云依赖的市场验证工具。一句话输入 → 自动多源数据采集 → AI 智能体生成 7 章节结构化报告。',
  url: 'https://insightforge.dev',
  repo: 'https://github.com/MatuX-ai/InsignForge',
  docs: 'https://github.com/MatuX-ai/InsignForge/blob/main/docs',
  releasesApi: 'https://api.github.com/repos/MatuX-ai/InsignForge/releases/latest',
  license: 'MIT',
  currentVersion: 'v1.0.2',
  desktopVersion: '1.0.2',
} as const;

export const NAV_LINKS = [
  { label: '特性', href: '#features' },
  { label: '工作流程', href: '#how' },
  { label: '截图', href: '#screenshots' },
  { label: '分发渠道', href: '#channels' },
  { label: '常见问题', href: '#faq' },
  { label: '更新日志', href: '#changelog' },
  { label: '下载', href: '#download' },
] as const;

export const FOOTER_LINKS = {
  product: [
    { label: '特性', href: '#features' },
    { label: '工作流程', href: '#how' },
    { label: '截图', href: '#screenshots' },
    { label: '下载', href: '#download' },
  ],
  resources: [
    { label: '文档', href: SITE.docs },
    { label: 'GitHub', href: SITE.repo },
    { label: '更新日志', href: '#changelog' },
    { label: 'FAQ', href: '#faq' },
  ],
  community: [
    { label: 'Issues', href: `${SITE.repo}/issues` },
    { label: 'Discussions', href: `${SITE.repo}/discussions` },
    { label: '贡献指南', href: `${SITE.repo}/blob/main/CONTRIBUTING.md` },
  ],
} as const;

export const SOCIAL_LINKS = [
  {
    label: 'GitHub',
    href: SITE.repo,
    icon: 'github',
  },
  {
    label: 'DeepSeek Harness',
    href: 'https://github.com/deepseek-ai/deepseek-harness',
    icon: 'plug',
  },
] as const;

export const DOWNLOAD_LINKS = {
  desktopInstaller: `${SITE.repo}/releases/download/v${SITE.desktopVersion}/InsightForge-${SITE.desktopVersion}-x64.exe`,
  desktopPortable: `${SITE.repo}/releases/download/v${SITE.desktopVersion}/InsightForge-${SITE.desktopVersion}-portable-x64.exe`,
  allReleases: `${SITE.repo}/releases`,
} as const;