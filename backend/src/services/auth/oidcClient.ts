/**
 * v2.0: OIDC Client 单例(openid-client v6)
 *
 * 启动时通过 discovery() 拉取 Casdoor 的 metadata,缓存 Configuration 实例。
 * 失败时给出明确日志但不阻塞其他接口(双轨制:未配置/失败时所有接口行为
 * 与 v1.6 完全一致)。
 *
 * Casdoor 是标准 OIDC provider,使用 issuer = `${endpoint}/.well-known/openid-configuration`。
 */
import * as oidc from 'openid-client';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

type Configuration = oidc.Configuration;

interface OidcClientBundle {
  config: Configuration;
  /** 当前使用的 redirect_uri(便于前端 OAuth 跳转对得上) */
  redirectUri: string;
}

let _bundle: OidcClientBundle | null = null;
let _initializing: Promise<OidcClientBundle | null> | null = null;

/**
 * 返回当前 OIDC Client 是否可用。
 * 单独提供以便中间件无副作用地判断是否走鉴权分支。
 */
export function isOidcConfigured(): boolean {
  if (!config.INSIGHTFORGE_AUTH_ENABLED) return false;
  return Boolean(
    config.INSIGHTFORGE_CASDOOR_ENDPOINT &&
      config.INSIGHTFORGE_CASDOOR_CLIENT_ID &&
      config.INSIGHTFORGE_CASDOOR_CLIENT_SECRET &&
      config.INSIGHTFORGE_CASDOOR_REDIRECT_URI
  );
}

/**
 * 懒加载 OIDC Client。失败返回 null,不抛。
 * - 二次调用复用第一次的 Promise(避免并发启动时重复 discover)
 */
export async function getOidcClient(): Promise<OidcClientBundle | null> {
  if (!isOidcConfigured()) return null;
  if (_bundle) return _bundle;
  if (_initializing) return _initializing;

  _initializing = (async () => {
    try {
      const endpoint = config.INSIGHTFORGE_CASDOOR_ENDPOINT!.replace(/\/+$/, '');
      const issuerUrl = `${endpoint}/.well-known/openid-configuration`;
      const cfg = await oidc.discovery(
        new URL(issuerUrl),
        config.INSIGHTFORGE_CASDOOR_CLIENT_ID!,
        config.INSIGHTFORGE_CASDOOR_CLIENT_SECRET!
      );
      _bundle = { config: cfg, redirectUri: config.INSIGHTFORGE_CASDOOR_REDIRECT_URI! };
      logger.info({ issuer: issuerUrl }, 'OIDC Client 初始化成功');
      return _bundle;
    } catch (err) {
      logger.error(
        { err },
        'OIDC Client 初始化失败(后续 /api/v1/auth/login 将返回 503)'
      );
      return null;
    } finally {
      _initializing = null;
    }
  })();
  return _initializing;
}

/**
 * 生成授权跳转 URL(用于 GET /api/v1/auth/login)。
 * state 在此处生成并写入 session(由调用方在 callback 中校验)。
 */
export async function buildAuthorizationUrl(state: string): Promise<string> {
  const bundle = await getOidcClient();
  if (!bundle) throw new Error('OIDC 未配置或初始化失败');
  const url: URL = oidc.buildAuthorizationUrl(bundle.config, {
    redirect_uri: bundle.redirectUri,
    scope: 'openid profile email',
    state,
  });
  return url.toString();
}

/**
 * 处理 callback:用 code 换 tokenSet + 拉 userinfo。
 * - currentUrl 是 callback 的完整 URL(包含 code/state 参数)
 */
export async function handleAuthorizationCallback(
  currentUrl: URL,
  expectedState: string
): Promise<{ tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers; userInfo: CasdoorUserInfo }> {
  const bundle = await getOidcClient();
  if (!bundle) throw new Error('OIDC 未配置或初始化失败');

  const checks: oidc.AuthorizationCodeGrantChecks = { expectedState };
  const tokens = await oidc.authorizationCodeGrant(
    bundle.config,
    currentUrl,
    checks
  );
  const subject = (tokens.claims?.() as { sub?: string } | undefined)?.sub;
  const userInfo = (await oidc.fetchUserInfo(
    bundle.config,
    tokens.access_token,
    subject ?? oidc.skipSubjectCheck
  )) as CasdoorUserInfo;
  return { tokens, userInfo };
}

/**
 * 从 Casdoor OIDC userinfo 中提取 InsightForge 关心的字段。
 * Casdoor 返回字段约定:
 *   sub        Casdoor 全局唯一 id → casdoor_id
 *   preferred_username / name / nickname → 兜底展示名
 *   email      主邮箱(必填)
 *   picture    头像 URL
 */
export interface CasdoorUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  nickname?: string;
  picture?: string;
  avatar_url?: string;
}

export function extractCasdoorUser(info: CasdoorUserInfo): {
  casdoorId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
} {
  const casdoorId = info.sub;
  const email = (info.email ?? `${casdoorId}@casdoor.local`).trim();
  const name =
    info.name?.trim() ||
    info.preferred_username?.trim() ||
    info.nickname?.trim() ||
    email.split('@')[0] ||
    casdoorId;
  const avatarUrl = info.picture ?? info.avatar_url ?? null;
  return { casdoorId, email, name, avatarUrl };
}

/** 生成 state 字符串(防 CSRF),v6 推荐 randomState */
export function generateState(): string {
  return oidc.randomState();
}

/** 测试辅助:重置单例 */
export function _resetOidcClientForTest(): void {
  _bundle = null;
  _initializing = null;
}