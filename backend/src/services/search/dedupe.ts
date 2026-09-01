/**
 * 多源采集引擎 - 智能去重
 *
 * 现有问题:
 *   - 仅按 URL 精确匹配,utm 参数 / fragment / trailing slash / 大小写不同视为不同
 *   - HN Algolia 偶尔会返回重复 hit
 *   - Reddit permalink 拼接后可能与外部 url 一致
 *
 * 本模块提供三层去重(层级叠加,后层在前层结果上运行):
 *   1. URL 归一化: normalizeUrl - 去 fragment / utm / 末斜杠 / 协议大小写 / www 前缀
 *   2. URL + 标题指纹: dedupeItems - Map<urlKey, item>;engagement 高者优先;空 url 走 fingerprint
 *   3. 标题语义: dedupeBySimilarTitle(v1.4 新增) - URL 不同但标题高度相似的"同一事件多源报道"也会合并
 *
 * 增量设计: 不引入 npm 依赖;第 3 层采用 Jaccard 系数计算轻量相似度(无需 embedding)。
 *   阈值默认 0.7,可通过参数调高 / 调低;低于阈值的视为不同主题,高合并。
 */
import { createHash } from 'node:crypto';
import type { MarketNeed } from '../../types/index.js';

export type DedupeKeyFn = (n: Pick<MarketNeed, 'title' | 'url' | 'source' | 'engagement'>) => string;

/** 规范化 URL: 去掉 tracking 参数 / fragment / 末尾斜杠 / 大小写归一 / 去 www. */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    // 1. 协议 / 主机名小写
    u.protocol = u.protocol.toLowerCase();
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    u.hostname = host;
    // 2. 去 fragment
    u.hash = '';
    // 3. 去常见 tracking 参数(utm_*, fbclid, gclid, ref, mc_cid, mc_eid, spm)
    const trackingPrefixes = ['utm_'];
    const trackingKeys = new Set([
      'fbclid',
      'gclid',
      'gbraid',
      'wbraid',
      'yclid',
      'msclkid',
      'mc_cid',
      'mc_eid',
      'spm',
      'ref',
      'ref_src',
      'source',
      '_hsenc',
      '_hsmi',
    ]);
    const removed: string[] = [];
    for (const k of Array.from(u.searchParams.keys())) {
      const lower = k.toLowerCase();
      if (trackingKeys.has(lower) || trackingPrefixes.some((p) => lower.startsWith(p))) {
        u.searchParams.delete(k);
        removed.push(k);
      }
    }
    // 4. 重新组装 search(空则不保留 ?)
    const search = u.searchParams.toString();
    u.search = search ? `?${search}` : '';
    // 5. pathname 去末尾斜杠(根路径除外)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    // 非合法 URL 原样返回(去 fragment + trailing slash 仍然尝试)
    return s.replace(/#.*$/, '').replace(/\/+$/, '') || s;
  }
}

/** 去重主入口: 按 urlKey 合并,engagement 高者胜出;空 url 走 fingerprint */
export function dedupeItems<
  T extends Pick<MarketNeed, 'title' | 'url' | 'source' | 'engagement' | 'author' | 'content'>
>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    const key = makeKey(it);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, it);
      continue;
    }
    // 冲突:按 engagement 高的胜出;平局保留先到的(更早被采纳)
    if ((it.engagement ?? 0) > (existing.engagement ?? 0)) {
      map.set(key, { ...existing, ...it });
    } else if ((it.engagement ?? 0) === (existing.engagement ?? 0)) {
      // 平局: 合并 author(避免空覆盖有值)
      map.set(key, {
        ...existing,
        author: existing.author ?? it.author ?? null,
        content: (existing.content?.length ?? 0) >= (it.content?.length ?? 0)
          ? existing.content
          : it.content,
      });
    }
  }
  return Array.from(map.values());
}

/** 构造去重 key: 优先 url 归一化,无 url 时用 title+source 指纹 */
function makeKey(item: {
  title?: string | null;
  url?: string | null;
  source?: string;
}): string {
  const normalized = normalizeUrl(item.url);
  if (normalized) return `u:${normalized}`;
  const fp = fingerprint(item.title ?? '', item.source ?? '');
  return `f:${fp}`;
}

/** 短指纹: title (归一化) + source 的 sha1 截断,空 title 返回 source-only 指纹 */
function fingerprint(title: string, source: string): string {
  const t = title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .slice(0, 120);
  return createHash('sha1').update(`${source}\u0000${t}`).digest('hex').slice(0, 16);
}

/** 导出便于测试的内部工具 */
export const _internals = { makeKey, fingerprint };

// ----------------------------------------------------------------------------
// 3. 标题语义去重 (v1.4 新增)
// ----------------------------------------------------------------------------

/**
 * 轻量英文后缀归一化(启发式,非 Porter Stemmer):
 *   按长度从长到短匹配后缀,避免短规则抢先匹配(s 规则会吃掉 boxes 末尾的 s,导致 boxe)。
 *   - sses -> ss:  dresses -> dress
 *   - ies -> y:    cities -> city
 *   - ing -> '':   running -> runn(不去重复辅音)
 *   - ed -> '':    released -> releas
 *   - es -> '':    boxes -> box, watches -> watch
 *   - s -> '':     tests -> test
 * 长度 < 4 的 token 不参与(避免 "is / as / us" 被误改)。
 */
export function englishStem(tok: string): string {
  if (tok.length < 4) return tok;
  const rules: Array<[RegExp, string]> = [
    [/sses$/, 'ss'],
    [/ies$/, 'y'],
    [/ing$/, ''],
    [/ed$/, ''],
    [/es$/, ''],
    [/s$/, ''],
  ];
  for (const [re, rep] of rules) {
    if (re.test(tok)) return tok.replace(re, rep);
  }
  return tok;
}

/** 标题语义合并默认阈值:Jaccard >= 0.7 视为同一事件的不同报道 */
export const DEFAULT_TITLE_DEDUPE_THRESHOLD = 0.7;

/**
 * 轻量分词:
 *   - 转小写
 *   - 保留 Unicode 字母 / 数字 / 空白(与 fingerprint() 保持一致)
 *   - 折叠空白
 *   - 过滤空串、单字符、纯数字(token 太短区分度低)
 *   - 默认剔除英文停用词(中英文都覆盖最常见几个)
 */
const STOPWORDS = new Set([
  // 英文
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'this', 'that', 'these', 'those', 'with', 'from', 'by', 'as', 'at',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our',
  'their', 'me', 'him', 'us', 'them',
  // 中文高频停用词(单字 + 常用虚词)
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '上', '也', '很', '到',
  '说', '要', '去', '你', '会', '着', '没', '看', '好', '这', '那', '把', '吗', '个', '里', '为',
  '之', '与', '而', '或', '其', '他', '她', '们', '但', '只', '还', '可', '并', '又', '才', '已',
]);

export function tokenize(title: string | null | undefined): string[] {
  if (!title) return [];
  // 1. 小写
  const lower = title.toLowerCase();
  // 2. 英文 / 数字区段:连续字母 / 数字序列视为一个 token
  //    中文区段:拆成单字 unigram(中文无空格,且很多词用单字表意)
  //    其余字符(标点)按分隔符处理
  const tokens: string[] = [];
  // \p{L} 任意字母 \p{N} 任意数字 \p{sc=Han} 汉字
  const re = /[\p{sc=Han}]|[a-z0-9]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    let tok = m[0];
    // 3. 英文后缀归一化:去除明显形态后缀(-sses/-ies/-ing/-ed/-es/-s),
    //   让"released / release"、"boxes / box"、"tests / test"能跨形式被识别为同主题。
    //   注意:这是"启发式"而非 Porter Stemmer;不做重复辅音压缩(released -> releas,不会变 relea)
    //   也不处理不规则变化(ran / run)。对当前需求(多源聚合同主题)够用。
    //   先检查停用词(避免 this -> thi 后脱表)
    if (/[a-z]/i.test(tok) && !STOPWORDS.has(tok)) {
      tok = englishStem(tok);
    }
    tokens.push(tok);
  }
  // 4. 过滤:停用词 / 纯数字 / 单字符(英文;汉字本身就是单字,保留)
  return tokens.filter((t) => {
    if (STOPWORDS.has(t)) return false;
    // 纯数字 token 一律过滤(无论是 "2024" 还是 "5")
    if (/^\d+$/.test(t)) return false;
    // 英文区段:过滤单字符(汉字本身就是 1 字符,不算"单字符")
    if (/^[a-z]+$/.test(t) && t.length < 2) return false;
    return true;
  });
}

/**
 * Jaccard 相似度: |A ∩ B| / |A ∪ B|
 *   - 输入为已 tokenize 后的字符串数组
 *   - 任一为空时返回 0(避免除零)
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 标题语义去重:
 *   - 输入通常是已经走过 dedupeItems 的列表
 *   - URL 不同但标题高相似(>= threshold)的视为同一事件,engagement 高者胜出
 *   - 空标题或单 token 的标题不参与相似度比较(避免误合并)
 *   - 不修改 url;只按内容聚合,engagement 高者胜出(同 dedupeItems 规则)
 *
 * 复杂度: O(n^2) 配对;输入一般 <100,够用。
 * 如未来需要性能优化,可换 union-find 或局部敏感哈希,这里保持简单。
 */
export function dedupeBySimilarTitle<
  T extends Pick<MarketNeed, 'title' | 'url' | 'source' | 'engagement' | 'author' | 'content'>
>(items: T[], opts: { threshold?: number } = {}): T[] {
  const threshold = Math.min(1, Math.max(0, opts.threshold ?? DEFAULT_TITLE_DEDUPE_THRESHOLD));

  // 预计算 token,避免 O(n^2) 重复分词
  const tokensOf = items.map((it) => tokenize(it.title));

  // 用 union-find 记录"被合并到哪个保留索引"
  const parent = items.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]!; // 路径压缩
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < items.length; i++) {
    if (tokensOf[i]!.length < 2) continue; // token 太短,跳过
    for (let j = i + 1; j < items.length; j++) {
      if (tokensOf[j]!.length < 2) continue;
      if (jaccardSimilarity(tokensOf[i]!, tokensOf[j]!) >= threshold) {
        union(i, j);
      }
    }
  }

  // 按组聚合;engagement 高者胜出,平局保留先到的(同 dedupeItems 规则)
  const grouped = new Map<number, { item: T; idx: number }>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const cur = grouped.get(root);
    const it = items[i]!;
    if (!cur) {
      grouped.set(root, { item: it, idx: i });
      continue;
    }
    if ((it.engagement ?? 0) > (cur.item.engagement ?? 0)) {
      grouped.set(root, { item: it, idx: i });
    } else if ((it.engagement ?? 0) === (cur.item.engagement ?? 0)) {
      // 平局: 合并 author / content(更长的 content 胜出)
      const merged = {
        ...cur.item,
        author: cur.item.author ?? it.author ?? null,
        content:
          (cur.item.content?.length ?? 0) >= (it.content?.length ?? 0)
            ? cur.item.content
            : it.content,
      };
      grouped.set(root, { item: merged, idx: cur.idx });
    }
  }

  // 按原数组顺序输出,避免改变已排序后的相对顺序
  const result: T[] = [];
  const seenRoots = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    result.push(grouped.get(root)!.item);
  }
  return result;
}
