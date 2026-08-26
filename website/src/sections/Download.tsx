/**
 * 下载区 - 主 CTA,提供桌面版下载和 Web 版指引
 */
import { Icon } from '../components/Icon';
import { CodeBlock } from '../components/CodeBlock';
import { DOWNLOAD_LINKS, SITE } from '../content/site';
import { useRevealAll } from '../hooks/useReveal';

export function Download() {
  const ref = useRevealAll<HTMLDivElement>();

  return (
    <section id="download" className="section">
      <div ref={ref} className="container-wide">
        <div className="glass-card relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-accent/20 blur-3xl"
          />

          <div className="relative grid gap-12 p-8 md:p-12 lg:grid-cols-[1.1fr_1fr]">
            {/* 主下载区 */}
            <div>
              <p className="reveal badge mb-4">
                <Icon name="download" className="h-3.5 w-3.5" />
                开始使用
              </p>
              <h2 className="reveal heading-2 text-text-primary">
                立即下载,5 分钟拿到第一份报告
              </h2>
              <p className="reveal mt-4 text-lg text-text-secondary">
                Windows 用户推荐桌面版,零环境依赖,双击即用。其他平台用户请使用 Docker Web 版。
              </p>

              <div className="reveal mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={DOWNLOAD_LINKS.desktopInstaller}
                  className="btn-primary group"
                >
                  <Icon name="download" className="h-5 w-5" />
                  下载安装版
                  <span className="ml-1 rounded-md bg-white/15 px-1.5 py-0.5 text-xs font-mono">
                    {SITE.desktopVersion}
                  </span>
                </a>
                <a
                  href={DOWNLOAD_LINKS.desktopPortable}
                  className="btn-secondary"
                >
                  <Icon name="download" className="h-5 w-5" />
                  下载便携版
                </a>
              </div>

              <ul className="reveal mt-6 space-y-2 text-sm text-text-secondary">
                {[
                  'NSIS 安装版 ·可选择安装目录、创建快捷方式',
                  '便携版 ·免安装,可放 U 盘随身携带',
                  'Windows 10/11 x64 ·约 80 MB',
                  '首次启动引导配置 DeepSeek / OpenAI API Key',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Icon name="check" className="mt-0.5 h-4 w-4 text-success" />
                    {t}
                  </li>
                ))}
              </ul>

              <p className="reveal mt-6 text-xs text-text-tertiary">
                需要 macOS / Linux 桌面版?{' '}
                <a href={`${SITE.repo}/issues`} className="link">
                  告诉我们
                </a>{' '}
                · 历史版本请前往{' '}
                <a href={DOWNLOAD_LINKS.allReleases} target="_blank" rel="noopener noreferrer" className="link">
                  Releases 页面
                </a>
              </p>
            </div>

            {/* 备选安装方式 */}
            <div className="reveal space-y-6">
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                  <Icon name="docker" className="h-4 w-4" />
                  Docker / Web 版
                </h3>
                <CodeBlock
                  commands={[
                    { label: '克隆', command: 'git clone https://github.com/MatuX-ai/InsignForge.git' },
                    { label: '启动', command: 'cd InsignForge && docker-compose up -d' },
                    { label: '访问', command: 'http://localhost:3000' },
                  ]}
                />
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                  <Icon name="plug" className="h-4 w-4" />
                  npm 工具链
                </h3>
                <CodeBlock
                  commands={[
                    { label: 'dsh 插件', command: 'npm i -g @insightforge/insightforge-dsh-plugin' },
                    { label: 'MCP 服务', command: 'npm i -g @insightforge/mcp-server' },
                    { label: '核心 SDK', command: 'npm i @insightforge/core' },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-border-solid bg-bg-tertiary/60 p-4">
                <p className="flex items-start gap-2 text-sm text-text-secondary">
                  <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-primary-light" />
                  <span>
                    所有下载产物均来自 GitHub Release 签名校验,无第三方分发。
                    SHA256 与 PGP 指纹见{' '}
                    <a href={`${SITE.repo}/releases`} target="_blank" rel="noopener noreferrer" className="link">
                      发布页
                    </a>
                    。
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}