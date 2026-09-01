/**
 * v2.0: OIDC 登录路由 — /api/v1/auth
 *
 *   GET  /auth/login      跳转 Casdoor 授权页(生成 state 写入 session)
 *   GET  /auth/callback   Casdoor 回调:code → token → userinfo → upsert → 写 session
 *   POST /auth/logout     销毁 session
 *   GET  /auth/me         返回当前用户(未登录返回 null)
 *
 * 鉴权关闭时:
 *   - /auth/login: 503 + 提示开启 INSIGHTFORGE_AUTH_ENABLED
 *   - /auth/callback: 同上
 *   - /auth/me: 返回 null
 *   - /auth/logout: 200 ok
 */
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { asyncHandler, ok, fail } from './response.js';
import {
  buildAuthorizationUrl,
  extractCasdoorUser,
  generateState,
  getOidcClient,
  handleAuthorizationCallback,
  isOidcConfigured,
} from '../services/auth/oidcClient.js';
import {
  findOrCreateByCasdoor,
  type UserRecord,
} from '../services/auth/userService.js';
import { getQuotaSnapshot } from '../middleware/quota.js';
import { logger } from '../logger.js';

export const authRouter = Router();

/**
 * 返回当前登录用户的精简视图(避免把内部字段全给前端)
 */
function toPublicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    plan_type: user.plan_type,
    quota: getQuotaSnapshot(user.id, user.plan_type),
  };
}

/**
 * 安全地往 session 写 OIDC state(扩展 express-session 的 SessionData)
 */
function setOidcState(req: Request, state: string): void {
  const sess = req.session as unknown as { oidcState?: string };
  sess.oidcState = state;
}
function getOidcState(req: Request): string | undefined {
  const sess = req.session as unknown as { oidcState?: string };
  return sess.oidcState;
}
function clearOidcState(req: Request): void {
  const sess = req.session as unknown as { oidcState?: string };
  delete sess.oidcState;
}
function setSessionUserId(req: Request, userId: string): void {
  const sess = req.session as unknown as { userId?: string };
  sess.userId = userId;
}

/**
 * GET /auth/me
 * 未登录返回 { user: null };鉴权关闭时同样返回 null
 */
authRouter.get(
  '/me',
  asyncHandler<Record<string, unknown>>((rawReq, res) => {
    const req = rawReq as unknown as Request;
    if (!config.INSIGHTFORGE_AUTH_ENABLED) {
      return ok(res, { user: null, authEnabled: false });
    }
    return ok(res, {
      user: req.user ? toPublicUser(req.user) : null,
      authEnabled: true,
    });
  })
);

/**
 * GET /auth/login
 * 鉴权未启用时返回 503;否则生成 state 写入 session 后重定向到 Casdoor
 */
authRouter.get(
  '/login',
  asyncHandler<Record<string, unknown>>(async (rawReq, res) => {
    const req = rawReq as unknown as Request;
    if (!isOidcConfigured()) {
      return fail(
        res,
        503,
        'OIDC 未启用或未配置。请设置 INSIGHTFORGE_AUTH_ENABLED=true 并填入 Casdoor 参数。'
      );
    }
    const bundle = await getOidcClient();
    if (!bundle) {
      return fail(res, 503, 'OIDC 客户端初始化失败,请检查 Casdoor endpoint 是否可达');
    }
    const state = generateState();
    const redirectUri = config.INSIGHTFORGE_CASDOOR_REDIRECT_URI ?? '';
    // 保存 state 到 session(OIDC 防 CSRF)
    setOidcState(req, state);
    const authUrl = await buildAuthorizationUrl(state);
    logger.info({ redirectUri }, '用户开始 OIDC 登录流程');
    res.redirect(authUrl);
  })
);

/**
 * GET /auth/callback
 * Casdoor 携带 code + state 跳回;校验 state → 换 token → upsert user → 写 session → 跳前端
 */
authRouter.get(
  '/callback',
  asyncHandler<Record<string, unknown>>(async (rawReq, res) => {
    const req = rawReq as unknown as Request;
    if (!isOidcConfigured()) {
      return fail(res, 503, 'OIDC 未配置');
    }
    const expectedState = getOidcState(req);
    if (!expectedState) {
      return fail(res, 400, 'session 中缺少 oidcState,请重新发起登录');
    }
    // 用完即删,防重放
    clearOidcState(req);

    const host = req.headers.host ?? 'localhost';
    const protocol = req.protocol;
    const url = new URL(req.originalUrl, `${protocol}://${host}`);
    if (url.searchParams.get('error')) {
      const err = url.searchParams.get('error');
      logger.warn(
        { err, desc: url.searchParams.get('error_description') },
        'OIDC 回调返回错误'
      );
      return fail(res, 400, `Casdoor 返回错误: ${err}`);
    }
    try {
      const { userInfo } = await handleAuthorizationCallback(url, expectedState);
      const extracted = extractCasdoorUser(userInfo);
      const user = findOrCreateByCasdoor(extracted);
      setSessionUserId(req, user.id);
      logger.info({ userId: user.id, email: user.email }, 'OIDC 登录成功');

      // 跳回前端。客户端回调页: /auth/callback,由前端决定后续跳转
      // 通过 redirect_uri 推断后端 origin,再拼装前端 callback 路径
      const backendOrigin = config.INSIGHTFORGE_CASDOOR_REDIRECT_URI
        ? new URL(config.INSIGHTFORGE_CASDOOR_REDIRECT_URI).origin
        : '';
      const frontendCallback = `${backendOrigin}/auth/callback`;
      res.redirect(frontendCallback || '/');
    } catch (err) {
      logger.error({ err }, 'OIDC 回调处理失败');
      return fail(
        res,
        502,
        `登录失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  })
);

/**
 * POST /auth/logout
 * 销毁 session 后返回 ok(鉴权关闭时也 200,但 session 本来就不存在)
 */
authRouter.post(
  '/logout',
  asyncHandler<Record<string, unknown>>((rawReq, res) => {
    const req = rawReq as unknown as Request;
    const session = req.session as unknown as
      | undefined
      | { destroy: (cb: (err?: Error) => void) => void };
    if (!session) {
      return ok(res, { loggedOut: true });
    }
    session.destroy((err?: Error) => {
      if (err) {
        logger.warn({ err }, 'session 销毁失败');
        return fail(res, 500, '注销失败');
      }
      // 清 cookie
      res.clearCookie('if.sid');
      return ok(res, { loggedOut: true });
    });
  })
);