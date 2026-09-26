/**
 * FAQ 页 - 底部导航「常见问题」入口
 * 内容同步自 docs/01-项目说明与需求说明书.md §9 + release-notes.md
 */
import { Card } from '../components/Card';
import { Container } from '../components/Container';

interface QA {
  q: string;
  a: string;
}

const faqs: QA[] = [
  {
    q: '我必须联网才能使用吗?',
    a: '是的,报告生成需要调用大模型 API 和搜索引擎 API。但你可以选择使用本地 Ollama 来减少对公网的依赖(设置 → 大模型 → Provider 选 Ollama)。',
  },
  {
    q: '我的数据会被上传到云端吗?',
    a: '不会。所有数据存储在本地 SQLite 数据库中,只有 API 调用会向外发送查询请求。若对数据安全要求极高,可开启「离线模式」(设置 → 离线模式),开启后所有外部 API 调用将被拒绝。',
  },
  {
    q: '支持哪些大模型?',
    a: '支持 10+ 国产与国际大模型:DeepSeek、智谱 GLM、通义千问(Qwen)、月之暗面 Kimi、零一万物 Yi、MiniMax、腾讯混元、商汤日日新、阶跃星辰,以及 OpenAI / Anthropic / Groq 等 OpenAI 兼容接口,也支持通过 Ollama 使用本地模型。',
  },
  {
    q: '搜索引擎怎么选?',
    a: '默认无需配置:讨论调研会使用内置示例数据 + AI 助理兜底,开箱即用。需要真实市场数据时可填入 SerpAPI Key 或自托管 OpenSerp 服务。',
  },
  {
    q: '爬虫会被目标网站封禁吗?',
    a: '个人版默认使用内置免配置搜索源 + AI 助理,直接抓取频率较低。如需大规模外部采集,可在设置 → 网络与代理中配置 HTTP / SOCKS5 代理池,降低被封风险。',
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
    <Container size="md">
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
        {/* 修复 P1-02: 之前的 URL 编码后是 "01-项目与需求说明书.md" 少了"说明"二字,
            点击会跳到 GitHub 404。现已补全为 "01-项目说明与需求说明书.md"。 */}
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
    </Container>
  );
}
