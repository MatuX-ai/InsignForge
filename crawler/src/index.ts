/**
 * Crawler 独立服务入口(占位)
 *
 * 当前 MVP 阶段,数据采集能力已实现在后端的 `backend/src/services/search/` 下:
 * - OpenSerpClient.ts  OpenSerp 搜索引擎封装
 * - HackerNewsClient.ts  HN Algolia 公开 API
 * - RedditClient.ts      Reddit 公开 JSON
 * - Aggregator.ts        多源聚合入库
 *
 * 此目录是为后续引入 Crawlee + Playwright 处理 JS 渲染页面预留的扩展点。
 * 计划在 v1.2 加入以下能力:
 *   - Product Hunt 公开页抓取
 *   - App Store / Google Play 评论采集
 *   - 知乎 / 微博 等需要 JS 渲染的中文站点
 *
 * 启动方式(占位脚本,实际不执行):
 *   cd crawler && npm install && npm run dev
 */
console.log('[crawler] 独立 Crawlee 服务占位。当前数据采集已内嵌至后端 services/search。');
console.log('[crawler] 后续 v1.2 将引入 Crawlee + Playwright 处理 JS 渲染页面。');
export {};