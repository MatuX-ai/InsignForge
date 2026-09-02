/**
 * 小红书搜索客户端 —— 接入骨架(skeleton,未实装)
 *
 * ⚠️ 为什么不实装:
 *   小红书无公开搜索接口,匿名 `GET https://www.xiaohongshu.com/api/sns/v1/search/notes`
 *   必须携带登录 cookie + `x-s` / `x-t` 算法签名 + `X-Bogus` 头,否则立即返回 404
 *   或触发滑块验证码。即使接入:
 *
 *     1. 小红书 User Agreement 与 robots.txt 明确不允许自动化抓取与商业转售;
 *     2. 公开的 `xhs-sign` / `X-Bogus` 逆向方案属于对抗性合规灰区,可能随时被识别;
 *     3. 限频非常激进(疑似 5/min),一次调研任务大概率全空。
 *
 * 本 Client 行为与 WeiboClient 一致:
 *   - **不调用 withReliability**,避免被熔断器计入失败次数;
 *   - 仅首次调用 warn 一次,源永久处于"未启用"状态;
 *   - 返回空数组,Aggregator 视同"该源本轮无命中"。
 *
 * 接入指南(未来实装时,需要同时做的事):
 *   1. 通过 SettingsService 注入用户登录 cookie(签名所需);
 *   2. 引入 / 自维护一个 x-s、x-t、X-Bogus 签名模块(参考 `xhs-sign` JS 实现);
 *   3. 在 `withReliability` 内加入 `fetchWithRetry`,把签名算法封装到请求头;
 *   4. 启用前完成 robots.txt + 用户协议审查,违反后果自负;
 *   5. 启用后请删掉本文件顶部的 `XHS_DISABLED` 标记并在 sourceWeights/aggregator 同步开启。
 */
import { logger } from '../../logger.js';
import type { MarketNeed, MarketNeedSource } from '../../types/index.js';

/** 接入未启用标记(供外部 grep / build 校验识别骨架文件) */
export const XHS_DISABLED = true;
/** 该源对外声明,与 MarketNeedSource 联合保持一致 */
const SOURCE: MarketNeedSource = 'xiaohongshu';

let warnedOnce = false;

export async function searchXiaohongshu(
  keyword: string,
  limit = 10
): Promise<Pick<MarketNeed, 'content' | 'title' | 'url' | 'source' | 'engagement' | 'author'>[]> {
  if (!keyword.trim()) return [];
  if (!warnedOnce) {
    warnedOnce = true;
    logger.warn(
      {
        source: SOURCE,
        note: 'XiaohongshuClient 当前为接入骨架,需登录 cookie + x-s/x-t 签名,匿名抓取不可用',
      },
      '小红书源未启用: 已跳过本次调用'
    );
  }
  void limit;
  return [];
}
