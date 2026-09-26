/**
 * 插件宿主 (v1.7.1 FR-13)
 *
 * 责任:
 *   - 注册插件
 *   - 按 capability + 优先级 + 启用开关,挑选"当下最合适"的插件执行
 *   - 失败时自动降级到下一个,而不是直接 500
 *   - 提供 /plugins 列表的元信息查询
 *
 * 当前已注册:
 *   - builtin-landing(兜底,default)
 *
 * 未来扩展:
 *   - dsh-landing (从 DeepSeek Harness 调用,priority 80)
 *   - typedream-landing (第三方平台,priority 30)
 *
 * 启用/禁用:
 *   - 通过环境变量 PLUGIN_<id>_ENABLED=false 关闭
 *   - 通过 settings 表(后续)用户级禁用
 */
import { builtinLandingPlugin } from './builtin-landing/index.js';
import type {
  LandingContext,
  LandingGeneratorPlugin,
  PluginManifest,
} from './types.js';
import { logger } from '../logger.js';

/** 所有已注册的 landing 生成器插件 */
const landingPlugins: LandingGeneratorPlugin[] = [builtinLandingPlugin];

/**
 * 给定 capability,挑出"已启用 + 优先级最高"的插件。
 * 若所有插件都被禁用,返回 null(上层应回退到内置).
 */
function pickPluginForLanding(): LandingGeneratorPlugin | null {
  const enabled = landingPlugins.filter((p) => isPluginEnabled(p.manifest.id));
  if (enabled.length === 0) {
    logger.warn('所有落地页插件都被禁用,调用将失败');
    return null;
  }
  // 排序: priority 降序 + default 优先
  enabled.sort((a, b) => {
    if (a.manifest.priority !== b.manifest.priority) {
      return b.manifest.priority - a.manifest.priority;
    }
    return (b.manifest.default ? 1 : 0) - (a.manifest.default ? 1 : 0);
  });
  return enabled[0]!;
}

/**
 * 判定某插件是否启用。
 *
 * 决策:
 *   1. 默认启用(builtin-landing 永远默认启用,除非显式关闭)
 *   2. 环境变量 PLUGIN_<id>_ENABLED=false 显式关闭
 *
 * 注意:
 *   - builtin-* 插件默认 true;其它插件默认 false(等待用户启用)
 *   - 永远不允许关闭所有 builtin-landing,因为它是兜底
 */
function isPluginEnabled(pluginId: string): boolean {
  const envKey = `PLUGIN_${pluginId.toUpperCase().replace(/-/g, '_')}_ENABLED`;
  const raw = process.env[envKey];
  if (raw !== undefined) {
    const lowered = raw.toLowerCase();
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
  }
  // 默认:builtin 启用,其它禁用(预留未来)
  return pluginId.startsWith('builtin-');
}

/**
 * 执行 landing.generate 能力
 *
 * 流程:
 *   1. 按优先级挑选首个可用插件
 *   2. 调用插件的 generateLanding
 *   3. 失败 → 降级到次优先级,直到用尽
 *   4. 全部失败 → 抛出 lastError
 *
 * 之所以"链式降级"而非"任一失败即抛错":
 *   dsh 远程调用可能因网络/鉴权失败,降级到 builtin-landing 可保证用户体验
 */
export async function invokeLandingGenerator(
  context: LandingContext,
  input: Parameters<LandingGeneratorPlugin['generateLanding']>[0]
): ReturnType<LandingGeneratorPlugin['generateLanding']> {
  const candidates = landingPlugins.filter((p) => isPluginEnabled(p.manifest.id));
  if (candidates.length === 0) {
    throw new Error('PLUGIN_NO_CANDIDATE: 没有可用的落地页生成插件');
  }

  // 按优先级排序
  candidates.sort((a, b) => b.manifest.priority - a.manifest.priority);

  let lastError: unknown = null;
  for (const plugin of candidates) {
    try {
      logger.info(
        { pluginId: plugin.manifest.id, priority: plugin.manifest.priority },
        'plugin: 调用落地页生成器'
      );
      const result = await plugin.generateLanding(input, context);
      return result;
    } catch (err) {
      lastError = err;
      logger.warn(
        { pluginId: plugin.manifest.id, err: err instanceof Error ? err.message : String(err) },
        'plugin: 落地页生成器失败,降级到下一个候选'
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('PLUGIN_ALL_FAILED: 所有落地页生成器均失败');
}

/** 列出所有已注册插件的元信息,供 GET /plugins */
export function listPlugins(): PluginManifest[] {
  return landingPlugins.map((p) => ({
    ...p.manifest,
    enabled: isPluginEnabled(p.manifest.id),
  }));
}

/** 单个插件详情 */
export function getPlugin(id: string): PluginManifest | undefined {
  const p = landingPlugins.find((x) => x.manifest.id === id);
  return p ? { ...p.manifest, enabled: isPluginEnabled(p.manifest.id) } : undefined;
}