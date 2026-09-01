/**
 * 调研错误码 → 中文友好提示 (后端镜像)
 *
 * 用途:
 *   - 测试与契约:与前端 frontend/src/lib/errorMessages.ts **一一对应**,任何一端改动必须同步另一端。
 *     不引入 React/Vite 依赖,纯 TS 数据 + 函数,便于 backend vitest 单测。
 *   - 后端日志:把 ErrorCode 翻译成可读文本,便于在 pino 日志里直接看到具体原因,
 *     不必让运维人员对照 KIND 常量表查。
 *
 * 注意:
 *   - 实际给前端 Banner 使用的是 frontend/src/lib/errorMessages.ts(同结构)。
 *   - 本文件仅用于日志 + 测试,不应在 API 响应中重复输出此文案(前端会自己展示)。
 *   - 字段含义与前端 FriendlyError 一致;不依赖 React/DOM 类型。
 */
import type { ErrorCode } from '../types/index.js';

/** 友好错误结构(与前端 FriendlyError 一一对应) */
export interface BackendFriendlyError {
  /** Banner 标题,简短有冲击力 */
  title: string;
  /** 详细原因 + 建议,1~2 句话 */
  detail: string;
  /** false 时 UI 不显示"重试"按钮 */
  retryable: boolean;
}

/** 与前端 FRIENDLY_ERRORS 一一对应,任何修改必须双端同步 */
export const BACKEND_FRIENDLY_ERRORS: Record<ErrorCode, BackendFriendlyError> = {
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

/** 一行式日志输出:PINO 可直接写入的扁平对象 */
export function explainErrorForLog(code: ErrorCode): {
  title: string;
  detail: string;
  retryable: boolean;
} {
  const e = BACKEND_FRIENDLY_ERRORS[code];
  return { title: e.title, detail: e.detail, retryable: e.retryable };
}