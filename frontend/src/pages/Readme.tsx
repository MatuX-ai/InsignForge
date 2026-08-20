/**
 * Readme 页 - 底部导航 readme 入口
 * 展示项目核心说明,更多细节请前往 GitHub 仓库。
 */
import { Card } from '../components/Card';

export function Readme() {
  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="text-title text-text-primary mb-2">InsightForge 个人版</h1>
      <p className="text-body text-text-secondary mb-6">
        让每一个好想法在被投入大量资源之前,先得到数据的检验。
      </p>

      <Card title="特性">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>零云依赖</strong>:所有数据存储在本地 SQLite,无需注册任何平台
          </li>
          <li>
            <strong>极简操作</strong>:输入一句话想法,自动生成 7 章节市场报告
          </li>
          <li>
            <strong>智能聚合</strong>:集成 OpenSerp 搜索 + Reddit / Hacker News 社区讨论
          </li>
          <li>
            <strong>结构化报告</strong>:市场热度、竞品识别、用户痛点、市场规模、风险机会、数据来源
          </li>
        </ul>
      </Card>

      <div className="my-6">
        <Card title="一键启动">
          <pre className="bg-hover-bg rounded p-3 text-helper overflow-x-auto">
{`git clone git@github.com:MatuX-ai/InsignForge.git insightforge
cd insightforge
cp .env.example .env   # 编辑 .env,填入 LLM_API_KEY
docker-compose up -d
# 打开 http://localhost:3000`}
          </pre>
        </Card>
      </div>

      <div className="my-6">
        <Card title="本地开发模式(无需 Docker)">
          <pre className="bg-hover-bg rounded p-3 text-helper overflow-x-auto">
{`# 后端
cd backend
npm install
npm run dev

# 前端(新开终端)
cd frontend
npm install
npm run dev`}
          </pre>
        </Card>
      </div>

      <div className="my-6">
        <Card title="项目结构">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className="px-1 bg-hover-bg rounded">backend/</code> Node.js 后端服务(Express + better-sqlite3)
            </li>
            <li>
              <code className="px-1 bg-hover-bg rounded">frontend/</code> React + Vite 前端
            </li>
            <li>
              <code className="px-1 bg-hover-bg rounded">crawler/</code> 独立抓取子进程
            </li>
            <li>
              <code className="px-1 bg-hover-bg rounded">dsh-plugin/</code> DeepSeek Harness 插件包
            </li>
            <li>
              <code className="px-1 bg-hover-bg rounded">docs/</code> 项目说明、需求、前端设计、技术文档
            </li>
          </ul>
        </Card>
      </div>

      <div className="text-helper text-text-secondary">
        完整文档与最新版本请前往
        <a
          href="https://github.com/MatuX-ai/InsignForge/blob/main/README.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline mx-1"
        >
          GitHub README
        </a>
        查看。
      </div>
    </main>
  );
}