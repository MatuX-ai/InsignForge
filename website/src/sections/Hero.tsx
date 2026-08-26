/**
 * Hero 区 - 首屏主视觉
 * 标题 + 副标题 + 主次 CTA + 装饰光晕 + 产品预览图(用 SVG/CSS 模拟)
 */
import { Icon } from '../components/Icon';
import { useReveal } from '../hooks/useReveal';
import { SITE } from '../content/site';

export function Hero() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section
      id="top"
      className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28"
    >
      {/* 装饰光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-hero-glow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-32 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/30 blur-[120px] animate-pulse-slow"
      />

      <div ref={ref} className="container-wide reveal">
        <div className="mx-auto max-w-4xl text-center">
          {/* 顶部徽章 */}
          <a
            href={`${SITE.repo}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge mb-8 hover:border-primary/60 hover:text-text-primary"
          >
            <img
              src="./logo.png"
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 rounded"
            />
            <span>{SITE.currentVersion} · 桌面版已发布</span>
            <Icon name="arrow" className="h-3 w-3" />
          </a>

          {/* 主标题 */}
          <h1 className="heading-1 text-text-primary">
            把产品想法变成
            <br />
            <span className="gradient-text">可决策的市场报告</span>
          </h1>

          {/* 副标题 */}
          <p className="mx-auto mt-6 max-w-2xl text-lg md:text-xl text-text-secondary leading-relaxed">
            完全本地化、零云依赖的市场验证工具。输入一句话想法,系统自动多源采集数据,
            AI 智能体生成 <strong className="text-text-primary">7 章节结构化报告</strong>,
            平均 5 分钟拿到决策依据。
          </p>

          {/* CTA 按钮组 */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#download" className="btn-primary group">
              <Icon name="download" className="h-5 w-5" />
              下载桌面版
              <Icon
                name="arrow"
                className="h-4 w-4 transition-transform group-hover:translate-x-1"
              />
            </a>
            <a href={SITE.repo} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              <Icon name="github" className="h-5 w-5" />
              在 GitHub 查看
            </a>
          </div>

          {/* 关键指标 */}
          <dl className="mt-16 grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { k: '5 分钟', v: '平均出报告时间' },
              { k: '7 章节', v: '结构化报告内容' },
              { k: '4 渠道', v: 'Web / 桌面 / 插件 / MCP' },
              { k: 'MIT', v: '完全开源可商用' },
            ].map((item) => (
              <div
                key={item.k}
                className="rounded-2xl border border-border bg-bg-secondary/40 p-4 backdrop-blur"
              >
                <dt className="text-2xl md:text-3xl font-bold gradient-text">{item.k}</dt>
                <dd className="mt-1 text-xs md:text-sm text-text-secondary">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* 产品预览 - 模拟报告页面 */}
        <div className="relative mx-auto mt-20 max-w-5xl">
          <div
            aria-hidden
            className="absolute -inset-8 -z-10 rounded-3xl bg-gradient-to-b from-primary/20 via-primary/5 to-transparent blur-3xl"
          />
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

/**
 * 产品预览组件 - 用 CSS/SVG 模拟 InsightForge 报告页 UI
 * 避免依赖实际截图,保证营销站零外部资源
 */
function HeroPreview() {
  return (
    <div className="glass-card overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-border bg-bg-secondary/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <div className="rounded-md border border-border-solid bg-bg-tertiary px-3 py-1 text-xs text-text-tertiary font-mono">
          localhost:3000/report/proj_8f3a
        </div>
        <div className="text-xs text-text-tertiary">InsightForge</div>
      </div>

      <div className="grid gap-0 md:grid-cols-[200px_1fr]">
        {/* 侧边栏 */}
        <aside className="border-b border-border bg-bg-secondary/40 p-4 md:border-b-0 md:border-r">
          <p className="mb-3 text-xs uppercase tracking-wider text-text-tertiary">章节</p>
          <ul className="space-y-1.5 text-sm">
            {[
              '执行摘要',
              '市场热度',
              '竞品识别',
              '用户痛点',
              '市场规模',
              '风险与机会',
              '数据来源',
            ].map((t, i) => (
              <li
                key={t}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${
                  i === 1
                    ? 'bg-primary/15 text-primary-light'
                    : 'text-text-secondary'
                }`}
              >
                <span className="font-mono text-xs opacity-50">0{i + 1}</span>
                {t}
              </li>
            ))}
          </ul>
        </aside>

        {/* 报告主体 */}
        <div className="p-6 md:p-8">
          <p className="text-xs uppercase tracking-wider text-text-tertiary">
            02 · 市场热度分析
          </p>
          <h2 className="mt-2 text-xl font-semibold text-text-primary">
            AI 编程助手市场热度持续上升
          </h2>

          {/* 热度条 */}
          <div className="mt-6 space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-text-secondary">搜索热度</span>
                <span className="font-mono text-primary-light">87 / 100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                <div className="h-full w-[87%] rounded-full bg-gradient-to-r from-primary to-accent" />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-text-secondary">社区讨论量</span>
                <span className="font-mono text-primary-light">72 / 100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-cyan to-primary" />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-text-secondary">趋势</span>
                <span className="font-mono text-success">↗ rising</span>
              </div>
            </div>
          </div>

          {/* 竞品卡片 */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { name: 'Copilot', share: '34%', color: 'from-primary to-accent' },
              { name: 'Cursor', share: '21%', color: 'from-cyan to-primary' },
            ].map((c) => (
              <div
                key={c.name}
                className="rounded-lg border border-border-solid bg-bg-tertiary/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{c.name}</span>
                  <span className="text-xs font-mono text-text-tertiary">
                    {c.share}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${c.color}`}
                    style={{ width: c.share }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}