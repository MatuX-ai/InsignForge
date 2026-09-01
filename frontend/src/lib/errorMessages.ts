/**
 * 调研错误码 → 中文友好提示
 *
 * 与后端 ErrorCode 一一对应,数据由 backend/src/services/search/reliability.ts 写入 execution.error_code。
 * 前端 Report 页拿到 errorCode 后,在 Banner 上展示对应的标题 + 建议,而不是干巴巴的"调研失败,请重试"。
 *
 * 设计:
 *   - title 简短(<= 18 字),用于 Banner 标题
 *   - detail 给具体建议;不让用户对着"网络错误"发呆
 *   - retryable=false 时,UI 隐藏"重试"按钮,避免无效点击
 *
 * 双端维护提醒:
 *   增删 ErrorCode 时,**同时**更新 frontend/src/types/index.ts 与本文件的 FRIENDLY_ERRORS;
 *   否则会出现"码 → 文案"对不上的退化(走 fallback 文案)。
 */
import type { ErrorCode } from '../types';

/** 友好错误结构 */
export interface FriendlyError {
  /** Banner 标题,简短有冲击力 */
  title: string;
  /** 详细原因 + 建议,1~2 句话 */
  detail: string;
  /** false 时 UI 不显示"重试"按钮(例如参数错误、鉴权缺失) */
  retryable: boolean;
}

/**
 * 错误码 → 友好提示的映射表。
 * 设计原则:
 *   - 标题使用陈述句,告诉用户"发生了什么"
 *   - detail 给具体可操作的建议(如"切换到其他 Provider"、"查看 API Key 是否过期")
 *   - SOURCE_RATE_LIMIT 鼓励稍候再试;SOURCE_CIRCUIT_OPEN 告知"该源暂时停用,稍后自动恢复"
 */
export const FRIENDLY_ERRORS: Record<ErrorCode, FriendlyError> = {
  MISSING_API_KEY: {
    title: '尚未配置大模型 API Key',
    detail: '请前往「设置」页面填写对应 Provider 的 API Key 后重试。',
    retryable: false,
  },
  INTERNAL_ERROR: {
    title: '调研过程出现异常',
    detail: '请稍后重试;若仍失败,请查看后端日志或联系管理员。',
    retryable: true,
  },
  SOURCE_NETWORK: {
    title: '网络异常',
    detail: '多源采集引擎无法连接外部数据源,请检查网络连通性后重试。',
    retryable: true,
  },
  SOURCE_TIMEOUT: {
    title: '数据源响应超时',
    detail: '外部数据源响应过慢,已重试仍失败。建议稍候再试,或在网络畅通时重试。',
    retryable: true,
  },
  SOURCE_RATE_LIMIT: {
    title: '触发数据源限流',
    detail: '外部接口返回 429(请求过于频繁)。请稍候 1~2 分钟后再试,避免连续触发限流。',
    retryable: true,
  },
  SOURCE_SERVER_5XX: {
    title: '数据源服务器异常',
    detail: '外部数据源返回 5xx(服务端错误)。这是上游问题,通常会在数分钟内自行恢复,请稍后重试。',
    retryable: true,
  },
  SOURCE_BAD_GATEWAY: {
    title: '数据源网关异常',
    detail: '外部数据源网关(502/503/504)暂时不可用。属临时性问题,稍后重试通常即可恢复。',
    retryable: true,
  },
  SOURCE_UNKNOWN_HTTP: {
    title: '数据源返回异常状态码',
    detail: '外部数据源返回了未预期的状态码。建议稍后重试,或换用其他搜索源(设置页可切换)。',
    retryable: true,
  },
  SOURCE_CLIENT_4XX: {
    title: '数据源请求被拒',
    detail: '外部数据源返回 4xx(请求参数错或鉴权失败)。请检查搜索源配置或更换 Provider。',
    retryable: false,
  },
  SOURCE_PARSE: {
    title: '数据源响应解析失败',
    detail: '外部数据源返回内容无法解析为预期结构。这通常是上游改版导致,后续版本会修复。',
    retryable: true,
  },
  SOURCE_CIRCUIT_OPEN: {
    title: '数据源熔断保护中',
    detail: '该数据源连续失败次数过多,已自动短路跳过以保护整体调研。冷却期(约 30 秒)结束后会自动恢复。',
    retryable: true,
  },
  SOURCE_VALIDATION: {
    title: '采集参数不合法',
    detail: '提交给数据源的关键词为空或过长,已拒绝本次请求。请检查项目描述与关键词。',
    retryable: false,
  },
};

/** 兜底文案(未知错误码时使用) */
const FALLBACK_ERROR: FriendlyError = {
  title: '调研失败',
  detail: '请稍后重试;若问题持续,请查看后端日志。',
  retryable: true,
};

/**
 * 解析错误码 → 友好提示。
 * - code 为 null 或不在表内 → 走兜底
 * - fallback 在 code 缺失时作为 detail 的补充(展示后端原始 message)
 */
export function explainError(
  code: ErrorCode | null | undefined,
  fallback?: string
): FriendlyError {
  if (code && code in FRIENDLY_ERRORS) {
    const fe = FRIENDLY_ERRORS[code];
    if (!fallback) return fe;
    return { ...fe, detail: `${fe.detail}\n详情:${fallback}` };
  }
  if (fallback) return { ...FALLBACK_ERROR, detail: fallback };
  return FALLBACK_ERROR;
}