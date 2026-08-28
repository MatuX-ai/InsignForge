/**
 * Hero 区 - 首屏主视觉
 * 左右双栏布局:左侧标题/描述/CTA/元数据,右侧终端预览
 * 设计目标:去 AI 套路化,用具体内容代替抽象 KPI 网格
 */
import { Icon } from '../components/Icon';
import { useReveal } from '../hooks/useReveal';
import { SITE } from '../content/site';

export function Hero() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section id="top" className="relative pt-28 pb-20 md:pt-32 md:pb-24">
      <div ref={ref} className="container-wide reveal">
        <div className="grid gap-12 md:grid-cols-[1.05fr_1fr] md:items-start md:gap-16">
          {/* 左栏:标题 + 描述 + CTA + 元数据 */}
          <div className="md:pt-6">
            {/* 顶部版本链接(下划线风格,代替 AI 套路化的圆角徽章+小图标) */}
            <a
              href={`${SITE.repo}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-b border-border-solid pb-1 text-xs text-text-secondary transition hover:border-primary/60 hover:text-text-primary"
            >
              <span className="font-mono">{SITE.currentVersion}</span>
              <span aria-hidden>·</span>
              <span>桌面版已发布</span>
              <Icon name="arrow" className="h-3 w-3" />
            </a>

            {/* 主标题 - 纯色,不用渐变文字 */}
            <h1 className="mt-6 text-4xl md:text-5xl font-bold tracking-tight leading-[1.15] text-text-primary">
              把产品想法变成
              <br />
              可决策的市场报告
            </h1>

            {/* 副标题 */}
            <p className="mt-5 max-w-lg text-base md:text-lg text-text-secondary leading-relaxed">
              完全本地化、零云依赖的市场验证工具。输入一句话想法,
              自动多源采集数据,AI 智能体生成 7 章节结构化报告,
              平均 5 分钟拿到决策依据。
            </p>

            {/* CTA 按钮组 - 复用现有 .btn-primary / .btn-secondary */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#download" className="btn-primary">
                下载桌面版
                <Icon name="arrow" className="h-4 w-4" />
              </a>
              <a
                href={SITE.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                <Icon name="github" className="h-4 w-4" />
                GitHub
              </a>
            </div>

            {/* 元数据列表 - 虚线分隔,呼应样图的边界感 */}
            <dl className="mt-10 grid max-w-md grid-cols-[1fr_auto] gap-y-3 border-t border-dashed border-border pt-5 text-xs">
              <dt className="text-text-tertiary">最近更新</dt>
              <dd className="font-mono text-text-secondary">2026-08-15</dd>
              <dt className="text-text-tertiary">协议</dt>
              <dd className="font-mono text-text-secondary">MIT · 可商用</dd>
              <dt className="text-text-tertiary">分发渠道</dt>
              <dd className="font-mono text-text-secondary">Web / 桌面 / 插件 / MCP</dd>
              <dt className="text-text-tertiary">数据外发</dt>
              <dd className="font-mono text-success">0</dd>
            </dl>
          </div>

          {/* 右栏:终端预览 */}
          <div className="md:pt-2">
            <HeroPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 终端预览 - 用命令行风格模拟 InsightForge 实际运行
 * 代替抽象的指标卡,提供"具体感"和"开发者向"质感
 */
function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-border-solid bg-bg-secondary font-mono">
      {/* 终端标题栏 */}
      <div className="flex items-center justify-between border-b border-border-solid bg-bg-tertiary px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <span className="text-[10px] text-text-tertiary">
          ~/Projects/proj_8f3a
        </span>
        <span className="text-[10px] text-text-tertiary">zsh</span>
      </div>

      {/* 终端内容 */}
      <div className="space-y-1.5 px-5 py-5 text-xs leading-relaxed">
        <div>
          <span className="text-success">$</span>
          <span className="ml-2 text-text-primary">insightforge analyze</span>
          <span className="ml-1 text-accent">&quot;AI 编程助手&quot;</span>
        </div>
        <div className="text-text-tertiary">
          → 启动 MarketResearcher 智能体...
        </div>
        <div className="text-text-tertiary">
          → 接入数据源 (Reddit · 微博 · 36氪 · Google Trends...)
        </div>
        <div className="text-text-tertiary">→ 生成 7 章节结构化报告</div>
        <div className="mt-3 flex items-center gap-2 text-success">
          <span>✓</span>
          <span>报告已生成</span>
          <span className="ml-auto text-text-tertiary">耗时 4m 32s</span>
        </div>
        <div className="mt-3 border-t border-dashed border-border pt-3 text-text-tertiary">
          report.md · 47 KB · 7 章节 · 0 云依赖
        </div>
      </div>
    </div>
  );
}