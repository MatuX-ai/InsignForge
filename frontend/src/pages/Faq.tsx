/**
 * FAQ 页 - 底部导航「常见问题」入口
 * 内容同步自 docs/01-项目说明与需求说明书.md §9
 */
import { Card } from '../components/Card';

interface QA {
  q: string;
  a: string;
}

const faqs: QA[] = [
  {
    q: '我必须联网才能使用吗?',
    a: '是的,报告生成需要调用大模型 API 和搜索引擎 API。但你可以选择使用本地模型(Ollama)来减少对公网的依赖。',
  },
  {
    q: '我的数据会被上传到云端吗?',
    a: '不会。所有数据存储在本地 SQLite 数据库中,只有 API 调用会向外发送查询请求。',
  },
  {
    q: '可以替换成其他大模型吗?',
    a: '可以。支持 OpenAI 兼容接口的任何模型,包括 DeepSeek、Claude、Groq 等。也支持通过 Ollama 使用本地模型。',
  },
  {
    q: '爬虫会被目标网站封禁吗?',
    a: '个人版默认使用 OpenSerp 作为搜索入口,并配置了合理的请求频率。如需大规模采集,建议配置代理池。',
  },
  {
    q: '报告生成大概需要多长时间?',
    a: '通常在 2-5 分钟,取决于网络速度和 API 响应时间。本地需求库命中缓存时可缩短至 30 秒内。',
  },
  {
    q: 'InsightForge 跟同类项目有什么区别?',
    a: '完全本地化、无需注册云服务、聚焦「市场验证」单一场景;不追求通用内容生成或 RAG 平台能力,目标是让独立创业者用 5 分钟拿到一份可决策的市场报告。',
  },
];

export function Faq() {
  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="text-title text-text-primary mb-6">常见问题</h1>

      <div className="space-y-4">
        {faqs.map((item, idx) => (
          <Card key={idx}>
            <div className="text-section text-text-primary mb-2">
              Q{idx + 1}.{item.q}
            </div>
            <div className="text-body text-text-primary">
              <strong className="text-primary">A:</strong>
              <span className="ml-1">{item.a}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="text-helper text-text-secondary mt-6">
        没有找到答案?
        <a
          href="https://github.com/MatuX-ai/InsignForge/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline mx-1"
        >
          在 GitHub 提 Issue
        </a>
        或查看
        <a
          href="https://github.com/MatuX-ai/InsignForge/blob/main/docs/01-%E9%A1%B9%E7%9B%AE%E8%AF%B4%E6%98%8E%E4%B8%8E%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%E4%B9%A6.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline ml-1"
        >
          完整项目文档
        </a>
        。
      </div>
    </main>
  );
}