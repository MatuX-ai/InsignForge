/**
 * 分发渠道 - 四种安装/使用方式
 */

export interface Channel {
  id: string;
  name: string;
  badge: string;
  audience: string;
  description: string;
  installCommands: { label: string; command: string }[];
  pros: string[];
  href?: string;
}

export const CHANNELS: Channel[] = [
  {
    id: 'desktop',
    name: '桌面版',
    badge: '推荐 · Windows',
    audience: '个人创业者 / 产品经理 / 非技术用户',
    description: '无需 Docker、无需 Node.js,下载安装包或便携版即可使用。内置后端子进程,数据写入 %APPDATA%\\InsightForge。',
    installCommands: [
      { label: 'NSIS 安装程序', command: 'InsightForge-1.0.2-x64.exe' },
      { label: '便携版(免安装)', command: 'InsightForge-1.0.2-portable-x64.exe' },
    ],
    pros: ['零环境依赖', '双击即用', '自动选择端口', '便携版可放 U 盘'],
    href: '#download',
  },
  {
    id: 'web',
    name: 'Web 版',
    badge: 'Docker',
    audience: '自托管用户 / 服务器部署',
    description: 'Docker Compose 一条命令拉起所有服务(后端 + 前端 + 数据库),适合部署在 VPS 或家用服务器上多人共用。',
    installCommands: [
      { label: '克隆仓库', command: 'git clone https://github.com/MatuX-ai/InsignForge.git' },
      { label: '一键启动', command: 'docker-compose up -d' },
      { label: '浏览器访问', command: 'http://localhost:3000' },
    ],
    pros: ['自托管可控', '适合团队 LAN', '可被反向代理暴露公网'],
    href: '#download',
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness 插件',
    badge: 'AI 工具链',
    audience: 'DeepSeek Harness 用户 / 命令行爱好者',
    description: '作为 DeepSeek Harness 插件运行,提供 market_research / search_demand / generate_landing / competitor 四个工具,可在 dsh 会话中被 LLM 直接调用。',
    installCommands: [
      { label: '安装插件', command: 'npm install -g @insightforge/insightforge-dsh-plugin' },
      { label: '查看工具', command: 'dsh tool list | grep insightforge' },
    ],
    pros: ['与 dsh 生态无缝集成', 'LLM 可自动调用', '无需启动 UI'],
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    badge: 'Claude / Cursor',
    audience: 'Claude Desktop / Cursor 用户 / AI 工程师',
    description: '实现 Model Context Protocol,作为本地服务被 Claude Desktop、Cursor 等 MCP 客户端发现,提供市场调研能力的工具集。',
    installCommands: [
      { label: '安装服务', command: 'npm install -g @insightforge/mcp-server' },
      { label: '添加到 Cursor', command: 'Settings → Features → Model Context Protocol' },
    ],
    pros: ['标准 MCP 协议', 'Claude Desktop 直接接入', '可被任意 MCP 客户端复用'],
  },
] as const;