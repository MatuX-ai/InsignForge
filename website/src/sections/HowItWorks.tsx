/**
 * 工作流程区 - 4 步骤时间线,展示从输入到报告的过程
 */
import { Icon } from '../components/Icon';
import { useRevealAll } from '../hooks/useReveal';

const STEPS = [
  {
    n: '01',
    icon: 'sparkles',
    useLogo: true,
    title: '输入想法',
    desc: '用一句话描述你的产品概念,系统自动拆解关键词并制定采集计划。',
    detail: '例如:"一个帮助独立开发者快速验证 SaaS 想法的桌面工具"',
  },
  {
    n: '02',
    icon: 'search',
    title: '多源采集',
    desc: '并行调用 OpenSerp 搜索引擎、Reddit 社区、Hacker News,抓取真实用户讨论。',
    detail: '约 30-60 秒,采集 50+ 条原始数据并附带来源链接。',
  },
  {
    n: '03',
    icon: 'bot',
    title: 'AI 智能分析',
    desc: 'Mastra 智能体自动聚类、识别竞品、提取痛点,生成结构化洞察。',
    detail: 'LLM 调用 1-2 次,平均 60-120 秒,模型可替换为 DeepSeek / OpenAI / Ollama。',
  },
  {
    n: '04',
    icon: 'file',
    title: '报告与落地页',
    desc: '输出 7 章节报告与可分享的验证落地页 HTML,直接用于假门测试。',
    detail: '导出 Markdown / PDF;落地页支持 light / dark 主题与邮箱订阅。',
  },
];

export function HowItWorks() {
  const ref = useRevealAll<HTMLDivElement>();

  return (
    <section id="how" className="section relative">
      <div ref={ref} className="container-narrow">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">工作流程</p>
          <h2 className="reveal heading-2 text-text-primary">
            从想法到报告,只需四步
          </h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            全流程自动化,无需人工整理素材或撰写 Prompt。
          </p>
        </div>

        <div className="relative">
          {/* 连接线(桌面) */}
          <div
            aria-hidden
            className="absolute left-8 top-0 hidden h-full w-px bg-gradient-to-b from-primary/50 via-accent/30 to-transparent md:left-1/2 md:block"
          />

          <div className="space-y-12">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className={`reveal relative grid gap-6 md:grid-cols-2 md:items-center ${
                  i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''
                }`}
              >
                {/* 数字徽章 - 桌面端居中 */}
                <div className="absolute left-8 top-2 -translate-x-1/2 md:relative md:left-0 md:top-auto md:translate-x-0 md:flex md:justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-glow">
                    {s.useLogo ? (
                      <img
                        src="./logo.png"
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7"
                      />
                    ) : (
                      <Icon name={s.icon} className="h-7 w-7" />
                    )}
                  </div>
                </div>

                {/* 内容卡片 */}
                <div className="glass-card ml-20 p-6 md:ml-0">
                  <p className="font-mono text-xs uppercase tracking-wider text-primary-light">
                    Step {s.n}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-text-primary">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                    {s.desc}
                  </p>
                  <p className="mt-3 rounded-md bg-bg-tertiary/60 p-3 text-xs text-text-tertiary leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}