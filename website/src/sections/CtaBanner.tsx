/**
 * 底部 CTA banner - 引导 star / fork / 下载
 */
import { Icon } from '../components/Icon';
import { SITE } from '../content/site';
import { useReveal } from '../hooks/useReveal';

export function CtaBanner() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section className="section pb-0">
      <div className="container-wide">
        <div ref={ref} className="reveal glass-card relative overflow-hidden border-primary/30 p-12 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10"
          />
          <div className="relative">
            <img
              src="./logo.png"
              alt=""
              width={64}
              height={64}
              className="mx-auto h-16 w-16 rounded-xl shadow-glow"
            />
            <h2 className="mt-4 heading-2 text-text-primary">
              如果 <span className="gradient-text">InsightForge</span> 对你有帮助
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
              给仓库点个 Star 是对我们最大的支持,也可以把它推荐给身边正在验证产品想法的朋友。
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href={`${SITE.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary group"
              >
                <Icon name="github" className="h-5 w-5" />
                Star on GitHub
                <Icon name="external" className="h-4 w-4" />
              </a>
              <a href="#download" className="btn-secondary">
                <Icon name="download" className="h-5 w-5" />
                下载桌面版
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}