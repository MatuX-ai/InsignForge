/**
 * 微博搜索客户端 —— 接入骨架(skeleton,未实装)
 *
 * ⚠️ 为什么不实装:
 *   微博搜索 API 在匿名访问下 100% 触发风控,直接返回 2755/10022 等业务错误码;
 *   即使加 `m.weibo.cn` 域与浏览器 UA,也会被滑块验证码拦截。生产可用路径只有:
 *
 *     1. 内部已经登录并拥有有效 cookie 的账号体系,通过 `Cookie: SUB=...; SUBP=...`
 *        等注入搜一次搜索(`https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D{urlencoded}`);
 *     2. 通过第三方风控授权(微博开放平台 OAuth)申请搜索接口;
 *     3. 自维护代理 IP 池配合低频调用(合规风险高,不推荐)。
 *
 * 本 Client 不直接 return [] 抛错,而是:
 *   - **不调用 withReliability**,避免空源被熔断器计入失败次数 → 报告卡片一直跳 1 个数据源掉线;
 *   - 仅在第一次调用时 warn 一次,提醒项目所有者该源当前未启用;
 *   - 默认返回空数组,Aggregator 视同"该源本轮无命中"。
 *
 * 接入指南(未来实装时):
 *   - 在 `SettingsService` 增加 `weiboCookie` 字段(从 `/api/v1/settings/weibo` 读取);
 *   - 在文件顶部 fetch 中附加 `headers: { Cookie: cookie }`;
 *   - 仍然走 `withReliability` + `fetchWithRetry` 与其它源共用熔断;
 *   - 启用后请删掉本文件顶部的 `WEIBO_DISABLED` 标记并在 sourceWeights/aggregator 同步开启。
 */
import { logger } from '../../logger.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

/** 接入未启用标记(供外部 grep / build 校验识别骨架文件) */
export const WEIBO_DISABLED = true;
/** 该源对外声明,与 MarketNeedSource 联合保持一致 */
const SOURCE: MarketNeedSource = 'weibo';

let warnedOnce = false;

export async function searchWeibo(
  keyword: string,
  limit = 10
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  if (!warnedOnce) {
    warnedOnce = true;
    logger.warn(
      { source: SOURCE, note: 'WeiboClient 当前为接入骨架,匿名抓取不可用,返回空数组不影响其他源' },
      '微博源未启用: 已跳过本次调用'
    );
  }
  void limit;
  // 协议上 `engagement/author` 都依赖登录态解析,匿名实现无法给出准确值
  return [];
}
