# InsightForge 营销网站

> [insightforge.dev](https://insightforge.dev) · 完全独立、与产品应用解耦的静态站

## 技术栈

- **React 18** + **Vite 5** + **TypeScript 5**
- **Tailwind CSS 3** —— 与产品应用 `frontend/` 复用同一套主题色与排版 token
- 输出纯静态 SPA,部署到任意静态托管(GitHub Pages / Vercel / Netlify / Nginx)

## 开发

```bash
# 安装依赖
npm install

# 本地预览(默认 http://localhost:5173)
npm run dev

# 类型检查
npm run typecheck

# 生产构建(产物: dist/)
npm run build

# 预览构建产物
npm run preview
```

## 目录结构

```
website/
├── public/                  # 原样拷贝到 dist 根
│   ├── favicon.png
│   ├── og-cover.png         # Open Graph 分享卡片
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── 404.html             # GitHub Pages / Vercel 接管
│   └── .nojekyll            # 防止 GitHub Pages 忽略 _ 前缀文件
├── src/
│   ├── content/             # 所有文案集中管理(特性 / FAQ / 版本日志 / 渠道)
│   ├── components/          # Nav / Footer / CodeBlock / Icon
│   ├── sections/            # 8 个独立 section 组件
│   ├── hooks/               # useReveal(滚动渐入)
│   ├── App.tsx              # 主组合
│   ├── main.tsx             # 入口
│   └── index.css            # Tailwind + 全局样式
├── index.html               # 含 SEO / Open Graph / JSON-LD
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

## Section 顺序与锚点

| Section          | 锚点          | 内容                                |
| ---------------- | ------------- | ----------------------------------- |
| Hero             | `#top`        | 标题 + CTA + 产品预览图             |
| Features         | `#features`   | 8 卡片特性网格                      |
| How It Works     | `#how`        | 4 步骤时间线                        |
| Screenshots      | `#screenshots`| 真实截图 + 缩略图墙                 |
| Channels         | `#channels`   | 4 种分发渠道对比                    |
| Changelog        | `#changelog`  | 已发布版本 + 路线图                  |
| FAQ              | `#faq`        | 10 条常见问题(手风琴)               |
| Download         | `#download`   | 桌面版下载 + Docker + npm 备选方案  |
| CTA Banner       | -             | 引导 Star / 下载                     |

## 数据来源

| 数据 | 来源 |
| ---- | ---- |
| 特性列表 | `src/content/features.ts` · 同步自 `README.md` §特性 与 `docs/01` §四 |
| FAQ      | `src/content/faq.ts`       · 同步自 `docs/01` §9 |
| Changelog| `src/content/changelog.ts` · 同步自 `release-notes.md` + `desktop/build` 流程 |
| Channels | `src/content/channels.ts`  · 同步自记忆「项目多渠道分发架构」 |
| 截图     | `data/screenshots/` → `public/screenshots/`(手动拷贝) |

修改任何文案请改 `src/content/*.ts`,构建后自动生效,无需改组件。

## 部署

### Vercel(推荐)

```bash
# 在 website/ 目录下
npm i -g vercel
vercel --prod
```

构建命令 `npm run build`,输出目录 `dist`,无需环境变量。

### GitHub Pages

1. 在仓库根创建 `.github/workflows/deploy-website.yml`(参见仓库内示例)
2. workflow 中 `working-directory: website`,上传 `website/dist` 到 `gh-pages` 分支

### Nginx

将 `dist/` 内容复制到 nginx 站点根目录,配置 `try_files $uri $uri/ /index.html;` 支持 SPA 路由。

## SEO 配置

- `<title>` / `<meta description>` / `<meta keywords>` 在 `index.html`
- Open Graph + Twitter Card 在 `index.html`
- JSON-LD `SoftwareApplication` 结构化数据
- `robots.txt` + `sitemap.xml` 在 `public/`
- 自定义 404 页在 `public/404.html`

## 设计语言

与产品应用 `frontend/` 完全一致:

- 主色 `#6366F1`(靛蓝紫)+ `#A78BFA`(紫)+ `#22D3EE`(青)
- 深色玻璃拟态 `bg-bg-secondary/40` + `backdrop-blur-xl` + `border-border`
- 标题用 `gradient-text` 渐变
- 字体栈:`-apple-system, Segoe UI, PingFang SC, Microsoft YaHei`

如需调整主题色,同时改 `tailwind.config.js` 即可。