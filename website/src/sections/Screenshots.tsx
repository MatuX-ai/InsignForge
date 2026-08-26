/**
 * 截图区 - 引用 data/screenshots 下真实截图(若不存在则降级为占位)
 */
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useRevealAll } from '../hooks/useReveal';
import { SITE } from '../content/site';

interface Shot {
  id: string;
  title: string;
  caption: string;
  src: string;
}

const SHOTS: Shot[] = [
  {
    id: 'home',
    title: '主界面',
    caption: '深色玻璃拟态主题,垂直居中布局,大标题 + 输入框 + 主按钮,首次启动自动引导配置 API Key。',
    src: './screenshots/after-select.png',
  },
  {
    id: 'report',
    title: '报告章节导航',
    caption: '7 章节结构化报告,带侧边栏锚点导航,可滚动浏览,可一键导出 Markdown / PDF。',
    src: './screenshots/ambiguous-panel.png',
  },
  {
    id: 'select',
    title: '示例选择与历史记录',
    caption: '从需求库一键载入示例想法,自动跳过重新输入,5 秒内启动调研流程。',
    src: './screenshots/fuzzy-error.png',
  },
];

export function Screenshots() {
  const ref = useRevealAll<HTMLDivElement>();
  const [active, setActive] = useState(SHOTS[0]);

  return (
    <section id="screenshots" className="section">
      <div ref={ref} className="container-wide">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="reveal badge mx-auto mb-4">产品截图</p>
          <h2 className="reveal heading-2 text-text-primary">看到它真实的样子</h2>
          <p className="reveal mt-4 text-lg text-text-secondary">
            来自桌面版与 Web 版的真实截图,无需注册即可体验。
          </p>
        </div>

        {/* 标签切换 */}
        <div className="reveal mb-8 flex flex-wrap justify-center gap-2">
          {SHOTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s)}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                active.id === s.id
                  ? 'bg-primary text-white shadow-glow-sm'
                  : 'border border-border-solid bg-bg-secondary/40 text-text-secondary hover:border-primary/60 hover:text-text-primary'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>

        {/* 主显示区 */}
        <div className="reveal grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-center">
          <div className="relative overflow-hidden rounded-2xl border border-border-solid bg-bg-tertiary shadow-glass">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/10 to-accent/10 blur-3xl"
            />
            <img
              src={active.src}
              alt={active.title}
              loading="lazy"
              className="w-full"
              onError={(e) => {
                const img = e.currentTarget;
                // 截图文件不存在时降级显示 SVG 占位,避免营销站破图
                if (!img.dataset.fallback) {
                  img.dataset.fallback = '1';
                  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(
                    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 500'>
                      <defs>
                        <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
                          <stop offset='0' stop-color='%236366F1' stop-opacity='.25'/>
                          <stop offset='1' stop-color='%23A78BFA' stop-opacity='.15'/>
                        </linearGradient>
                      </defs>
                      <rect width='800' height='500' fill='%230F172A'/>
                      <rect width='800' height='500' fill='url(%23g)'/>
                      <g fill='%23F1F5F9' font-family='-apple-system,Segoe UI,sans-serif' text-anchor='middle'>
                        <text x='400' y='240' font-size='28' font-weight='600'>${active.title}</text>
                        <text x='400' y='275' font-size='14' fill='%2394A3B8'>截图待补充 · ${SITE.repo}</text>
                      </g>
                    </svg>`
                  )}`;
                }
              }}
            />
          </div>

          <div className="space-y-6">
            <h3 className="text-2xl font-semibold text-text-primary">{active.title}</h3>
            <p className="text-text-secondary leading-relaxed">{active.caption}</p>
            <ul className="space-y-3 text-sm">
              {[
                '深色玻璃拟态设计语言,长时间阅读更舒适',
                '完整 7 章节结构,自带侧边锚点导航',
                '支持导出 Markdown / PDF / 落地页 HTML',
              ].map((p) => (
                <li key={p} className="flex items-start gap-2 text-text-secondary">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 截图缩略图墙 */}
        <div className="reveal mt-12 grid gap-4 sm:grid-cols-3">
          {SHOTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s)}
              className={`group relative overflow-hidden rounded-2xl border bg-bg-tertiary transition ${
                active.id === s.id
                  ? 'border-primary shadow-glow-sm'
                  : 'border-border-solid hover:border-primary/40'
              }`}
            >
              <img
                src={s.src}
                alt={s.title}
                loading="lazy"
                className="aspect-video w-full object-cover object-top transition group-hover:scale-105"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.dataset.fallback) {
                    img.dataset.fallback = '1';
                    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(
                      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 225'>
                        <rect width='400' height='225' fill='%231E293B'/>
                        <text x='200' y='115' fill='%2394A3B8' font-family='sans-serif' font-size='14' text-anchor='middle'>${s.title}</text>
                      </svg>`
                    )}`;
                  }
                }}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/95 to-transparent p-3 text-left">
                <p className="text-xs font-medium text-text-primary">{s.title}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}