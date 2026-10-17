/**
 * PRD-018/T4 · 只读 MCP 的鉴权与限流（trend #74）。
 *
 * T1 设计（trend #71 / brain-27 PR #17 §五）：匿名低频免费、高频需 token；
 * 结果缓存防 D1 被刷爆；只读 scope 不可写。
 *
 * 本模块是 dispatchToolCall 的鉴权包装层（纯函数 + 可擦除 TypeScript，
 * 无 enum / 无命名空间，可被 node --test 直接运行）：
 *   1. 鉴权：token 有效 → token 配额；无 token → 匿名配额；token 无效 → 400。
 *   2. 限流：滑动窗口；超限 → 429 + retry_after（MCP_ERROR_CODES 语义）。
 *   3. 缓存：tool + 参数哈希，短 TTL；命中直接返回。
 *   4. 降级：loadEntries 抛错时用上次成功数据 + stale 标记；无缓存 → 503。
 *
 * 关键取舍（详见 docs/plans/2026-10-17-mcp-t4-auth.md）：
 * - 缓存命中仍计入配额（fail-closed：限流同时保护 API 本身）。
 * - 缓存键不含身份：结果与身份无关（只读公开数据），配额才分档。
 * - stale 结果不写缓存：源恢复后下一次调用即重试。
 * - 默认拒绝：未配置 token / verifyToken 时任何 token 都无效。
 */
import { dispatchToolCall, McpError } from "./tools.ts";
import type { McpContext, McpOpportunity } from "./tools.ts";

// ── 配额 ──────────────────────────────────────────────────────────────────

export type QuotaConfig = {
  /** 滑动窗口长度（毫秒）。 */
  windowMs: number;
  /** 窗口内最大请求数。 */
  maxRequests: number;
};

/** 匿名配额：低频免费（T1 §五）。 */
export const DEFAULT_ANON_QUOTA: QuotaConfig = { windowMs: 60_000, maxRequests: 30 };

/** token 配额：高频需 token（T1 §五）。 */
export const DEFAULT_TOKEN_QUOTA: QuotaConfig = { windowMs: 60_000, maxRequests: 300 };

/** 结果缓存 TTL（毫秒）：短 TTL，防 D1 被刷爆的同时保证新鲜度。 */
export const DEFAULT_CACHE_TTL_MS = 60_000;

// ── Token 校验 ────────────────────────────────────────────────────────────

/**
 * Token 校验函数。默认实现为配置注入的 allowlist；生产环境应替换为
 * HMAC/JWT 等校验器（签名即换即生效，无需改本模块）。
 */
export type TokenVerifier = (token: string) => boolean;

function makeAllowlistVerifier(tokens: readonly string[]): TokenVerifier {
  const set = new Set(tokens);
  return (t) => set.has(t);
}

// ── 配置 ──────────────────────────────────────────────────────────────────

export type AuthConfig = {
  anonQuota?: QuotaConfig;
  tokenQuota?: QuotaConfig;
  cacheTtlMs?: number;
  /** 自定义校验器；不传则用 tokens allowlist（默认空 = 全部拒绝）。 */
  verifyToken?: TokenVerifier;
  tokens?: readonly string[];
  /** 可注入时钟（测试用）；默认 Date.now。 */
  now?: () => number;
};

export type ResolvedAuthConfig = {
  anonQuota: QuotaConfig;
  tokenQuota: QuotaConfig;
  cacheTtlMs: number;
  verifyToken: TokenVerifier;
  now: () => number;
};

export function resolveAuthConfig(cfg: AuthConfig = {}): ResolvedAuthConfig {
  return {
    anonQuota: cfg.anonQuota ?? DEFAULT_ANON_QUOTA,
    tokenQuota: cfg.tokenQuota ?? DEFAULT_TOKEN_QUOTA,
    cacheTtlMs: cfg.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    verifyToken: cfg.verifyToken ?? makeAllowlistVerifier(cfg.tokens ?? []),
    now: cfg.now ?? (() => Date.now()),
  };
}

// ── 滑动窗口限流 ──────────────────────────────────────────────────────────

/** 限流键 → 窗口内命中时间戳（毫秒，升序）。由调用方持有、可跨调用复用。 */
export type RateLimitState = Map<string, number[]>;

/**
 * FNV-1a 32-bit。非加密哈希，仅用于限流键去标识化（不在日志/存储中
 * 留 token 明文），不作安全用途。
 */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

/** 滑动窗口检查：通过则记一次命中；超限返回 retry_after（秒）。 */
export function checkRateLimit(
  state: RateLimitState,
  key: string,
  quota: QuotaConfig,
  now: number,
): RateLimitVerdict {
  const windowStart = now - quota.windowMs;
  let hits = state.get(key);
  if (!hits) {
    hits = [];
    state.set(key, hits);
  }
  let i = 0;
  while (i < hits.length && hits[i] <= windowStart) i++;
  if (i > 0) hits.splice(0, i);
  if (hits.length >= quota.maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + quota.windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  return { allowed: true };
}

// ── 鉴权 ──────────────────────────────────────────────────────────────────

export type AuthTier = "anon" | "token";

export type AuthIdentity = {
  tier: AuthTier;
  /** 限流键：token 档为哈希，匿名档为调用方标识。 */
  rateLimitKey: string;
};

/**
 * 鉴权。token 非空 → 校验（无效 → 400 fail-fast，不烧配额）；
 * 无 token → 匿名档（调用方负责传入 callerKey，如客户端 IP；缺省则共用桶）。
 */
export function authenticate(
  token: string | null | undefined,
  callerKey: string | undefined,
  cfg: ResolvedAuthConfig,
): AuthIdentity {
  if (token !== undefined && token !== null && token !== "") {
    if (!cfg.verifyToken(token)) {
      throw new McpError(400, "token 无效", {
        hint: "请检查 token 是否正确，或以匿名身份使用低频配额",
      });
    }
    return { tier: "token", rateLimitKey: "tok:" + hashKey(token) };
  }
  const key = callerKey !== undefined && callerKey !== "" ? callerKey : "unknown";
  return { tier: "anon", rateLimitKey: "anon:" + key };
}

// ── 结果缓存 ──────────────────────────────────────────────────────────────

export type CacheEntry = { value: unknown; expiresAt: number };

/** 结果缓存：调用方持有、可跨调用复用。键 = tool + 参数哈希（不含身份）。 */
export type ResultCache = Map<string, CacheEntry>;

/** 稳定序列化：对象键排序，保证参数顺序不同但语义相同 → 同一缓存键。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") +
    "}"
  );
}

export function cacheKeyFor(tool: string, args: Record<string, unknown>): string {
  return tool + ":" + stableStringify(args);
}

// ── Stale 降级 ────────────────────────────────────────────────────────────

/** 上次成功的数据快照：调用方持有、可跨调用复用。 */
export type StaleStore = {
  entries: McpOpportunity[] | null;
  loadedAt: number | null;
};

export function createStaleStore(): StaleStore {
  return { entries: null, loadedAt: null };
}

// ── 鉴权包装调用 ──────────────────────────────────────────────────────────

export type AuthorizedCallRequest = {
  tool: string;
  args: Record<string, unknown>;
  ctx: McpContext;
  /** Bearer token（可选）。 */
  token?: string | null;
  /** 调用方标识（如客户端 IP），用于匿名档限流键；缺省共用桶。 */
  callerKey?: string;
  /**
   * 数据源加载函数（可选）。提供时：成功则刷新 stale 快照；抛错则用快照
   * 降级（stale: true）；无快照则抛 503。不提供时直接用 ctx.entries。
   */
  loadEntries?: () => McpOpportunity[];
};

export type AuthorizedCallDeps = {
  config?: AuthConfig;
  rateLimits?: RateLimitState;
  cache?: ResultCache;
  stale?: StaleStore;
};

export type AuthorizedCallOutcome = {
  ok: true;
  value: unknown;
  /** 是否命中结果缓存。 */
  cached: boolean;
  /** 是否为 stale 降级数据（源不可用时）。 */
  stale: boolean;
  /** stale 数据的快照时间（毫秒时间戳），非 stale 时缺省。 */
  staleAt?: number;
};

/**
 * 带鉴权/限流/缓存/降级的 tool 调用。错误以 McpError 抛出：
 * 400（token 无效 / 参数非法 / 未知 tool）、429（超限，带 retry_after）、
 * 503（数据源不可用且无快照）。
 */
export function authorizedCall(
  req: AuthorizedCallRequest,
  deps: AuthorizedCallDeps = {},
): AuthorizedCallOutcome {
  const cfg = resolveAuthConfig(deps.config);
  const now = cfg.now();
  const rateLimits = deps.rateLimits ?? new Map<string, number[]>();
  const cache = deps.cache ?? new Map<string, CacheEntry>();
  const stale = deps.stale ?? createStaleStore();

  // 1. 鉴权
  const identity = authenticate(req.token, req.callerKey, cfg);

  // 2. 限流（缓存命中同样计入配额：限流同时保护 API 本身）
  const quota = identity.tier === "token" ? cfg.tokenQuota : cfg.anonQuota;
  const rl = checkRateLimit(rateLimits, identity.rateLimitKey, quota, now);
  if (!rl.allowed) {
    throw new McpError(429, "触发限流", {
      retry_after: rl.retryAfterSec,
      hint:
        identity.tier === "anon"
          ? "匿名配额已用完，提供有效 token 可提升配额"
          : "token 配额已用完，请稍后重试",
    });
  }

  // 3. 结果缓存
  const ckey = cacheKeyFor(req.tool, req.args);
  const hit = cache.get(ckey);
  if (hit) {
    if (hit.expiresAt > now) {
      return { ok: true, value: hit.value, cached: true, stale: false };
    }
    cache.delete(ckey);
  }

  // 4. 数据源（可选 stale 降级）
  let entries = req.ctx.entries;
  let isStale = false;
  let staleAt: number | undefined;
  if (req.loadEntries) {
    try {
      entries = req.loadEntries();
      stale.entries = entries;
      stale.loadedAt = now;
    } catch {
      if (stale.entries !== null) {
        entries = stale.entries;
        isStale = true;
        if (stale.loadedAt !== null) staleAt = stale.loadedAt;
      } else {
        throw new McpError(503, "数据源暂不可用", {
          hint: "暂无缓存数据，请稍后重试",
        });
      }
    }
  }

  // 5. 分发（参数错误/未知 tool 以 400 透出，不吞错）
  const value = dispatchToolCall(req.tool, req.args, { ...req.ctx, entries });

  // 6. 写缓存（stale 结果不写：源恢复后下一次调用即重试）
  if (!isStale) {
    cache.set(ckey, { value, expiresAt: now + cfg.cacheTtlMs });
  }

  return {
    ok: true,
    value,
    cached: false,
    stale: isStale,
    ...(staleAt !== undefined ? { staleAt } : {}),
  };
}
