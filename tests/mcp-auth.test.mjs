import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticate,
  authorizedCall,
  cacheKeyFor,
  checkRateLimit,
  createStaleStore,
  hashKey,
  resolveAuthConfig,
  stableStringify,
} from "../lib/mcp/auth.ts";
import { McpError } from "../lib/mcp/tools.ts";

// ── 合成条目（虚构数据，仅用于鉴权/限流/缓存测试） ────────────────────────

function entry(id, title, deadline, daysNote) {
  return {
    id,
    title,
    source: "测试来源",
    source_url: "https://example.test/",
    source_type: "manual",
    d1_evidence: null,
    confidence: "high",
    created: "2026-10-17",
    last_verified: "2026-10-17",
    status: "active",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    body: "合成测试条目" + (daysNote ?? ""),
    org: "Test Org",
    deadline,
    funding_note: null,
  };
}

const ENTRIES = [
  entry("e1", "UCL 认知神经科学博士", "2027-01-08"),
  entry("e2", "港中文脑成像 RA", "2026-11-30"),
];

// ── 测试脚手架 ────────────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  let now = 1_000_000;
  const deps = {
    config: {
      anonQuota: { windowMs: 60_000, maxRequests: 2 },
      tokenQuota: { windowMs: 60_000, maxRequests: 5 },
      cacheTtlMs: 60_000,
      tokens: ["tok-test-1"],
      now: () => now,
      ...overrides,
    },
    rateLimits: new Map(),
    cache: new Map(),
    stale: createStaleStore(),
  };
  return { deps, setNow: (t) => (now = t), getNow: () => now };
}

const CTX = { entries: ENTRIES, now: "2026-10-17" };
const ARGS = { direction: "脑机接口", limit: 5 };

function callOk(deps, extra = {}) {
  return authorizedCall(
    { tool: "search_opportunities", args: { ...ARGS }, ctx: CTX, callerKey: "1.2.3.4", ...extra },
    deps,
  );
}

function assertMcpError(fn, code) {
  assert.throws(fn, (e) => e instanceof McpError && e.code === code);
}

// ── 鉴权 ──────────────────────────────────────────────────────────────────

test("无 token → 匿名档；有效 token → token 档", () => {
  const cfg = resolveAuthConfig({ tokens: ["tok-test-1"] });
  const anon = authenticate(undefined, "1.2.3.4", cfg);
  assert.equal(anon.tier, "anon");
  assert.ok(anon.rateLimitKey.startsWith("anon:"));
  const tok = authenticate("tok-test-1", "1.2.3.4", cfg);
  assert.equal(tok.tier, "token");
  assert.ok(tok.rateLimitKey.startsWith("tok:"));
  // 同一 token 的限流键稳定（且非明文）
  assert.equal(tok.rateLimitKey, authenticate("tok-test-1", "9.9.9.9", cfg).rateLimitKey);
  assert.ok(!tok.rateLimitKey.includes("tok-test-1"));
});

test("无效 token → 400 fail-fast", () => {
  const { deps } = makeDeps();
  assertMcpError(
    () => authorizedCall({ tool: "search_opportunities", args: { ...ARGS }, ctx: CTX, token: "bad-token" }, deps),
    400,
  );
  // 400 不烧配额：同 key 匿名仍可用
  const out = callOk(deps);
  assert.equal(out.ok, true);
});

test("hashKey 去标识化且稳定", () => {
  assert.equal(hashKey("tok-test-1"), hashKey("tok-test-1"));
  assert.notEqual(hashKey("tok-test-1"), hashKey("tok-test-2"));
});

// ── 限流 ──────────────────────────────────────────────────────────────────

test("匿名配额内放行，超限 → 429 + retry_after", () => {
  const { deps } = makeDeps();
  assert.equal(callOk(deps).ok, true);
  assert.equal(callOk(deps).ok, true);
  let err = null;
  try {
    callOk(deps);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof McpError && err.code === 429);
  assert.ok(err.data.retry_after >= 1);
  assert.match(err.data.hint, /token/);
});

test("有效 token 走更高配额", () => {
  const { deps } = makeDeps();
  for (let i = 0; i < 5; i++) {
    const out = callOk(deps, { token: "tok-test-1" });
    assert.equal(out.ok, true);
  }
  assertMcpError(() => callOk(deps, { token: "tok-test-1" }), 429);
});

test("token 档与匿名档配额隔离", () => {
  const { deps } = makeDeps();
  callOk(deps);
  callOk(deps);
  assertMcpError(() => callOk(deps), 429); // 匿名桶空了
  assert.equal(callOk(deps, { token: "tok-test-1" }).ok, true); // token 档不受影响
});

test("滑动窗口过期后配额恢复", () => {
  const { deps, setNow, getNow } = makeDeps();
  callOk(deps);
  callOk(deps);
  assertMcpError(() => callOk(deps), 429);
  setNow(getNow() + 61_000);
  assert.equal(callOk(deps).ok, true);
});

test("checkRateLimit 单元：窗口滑动与 retry_after", () => {
  const state = new Map();
  const q = { windowMs: 10_000, maxRequests: 1 };
  assert.deepEqual(checkRateLimit(state, "k", q, 0), { allowed: true });
  const v = checkRateLimit(state, "k", q, 1000);
  assert.equal(v.allowed, false);
  assert.equal(v.retryAfterSec, 9);
  assert.deepEqual(checkRateLimit(state, "k", q, 10_001), { allowed: true });
});

// ── 缓存 ──────────────────────────────────────────────────────────────────

test("缓存命中：loadEntries 只跑一次", () => {
  const { deps } = makeDeps();
  let loads = 0;
  const req = (extra = {}) => ({
    tool: "search_opportunities",
    args: { ...ARGS },
    ctx: CTX,
    callerKey: "1.2.3.4",
    loadEntries: () => {
      loads++;
      return ENTRIES;
    },
    ...extra,
  });
  const r1 = authorizedCall(req(), deps);
  assert.equal(r1.cached, false);
  const r2 = authorizedCall(req(), deps);
  assert.equal(r2.cached, true);
  assert.deepEqual(r2.value, r1.value);
  assert.equal(loads, 1);
});

test("不同参数缓存互不干扰；参数顺序不影响缓存键", () => {
  const { deps } = makeDeps();
  const a = { direction: "脑机接口", limit: 5 };
  const b = { limit: 5, direction: "脑机接口" };
  assert.equal(cacheKeyFor("search_opportunities", a), cacheKeyFor("search_opportunities", b));
  const r1 = authorizedCall({ tool: "search_opportunities", args: a, ctx: CTX, callerKey: "1.2.3.4" }, deps);
  assert.equal(r1.cached, false);
  const r2 = authorizedCall({ tool: "search_opportunities", args: b, ctx: CTX, callerKey: "5.6.7.8" }, deps);
  assert.equal(r2.cached, true);
  const r3 = authorizedCall(
    { tool: "search_opportunities", args: { direction: "脑成像", limit: 5 }, ctx: CTX, callerKey: "1.2.3.4" },
    deps,
  );
  assert.equal(r3.cached, false);
});

test("stableStringify 嵌套对象键排序", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 1 } }), stableStringify({ a: { c: 1, d: 2 }, b: 1 }));
});

test("TTL 过期后重新计算", () => {
  const { deps, setNow, getNow } = makeDeps();
  let loads = 0;
  const req = () => ({
    tool: "search_opportunities",
    args: { ...ARGS },
    ctx: CTX,
    callerKey: "9.9.9.9",
    loadEntries: () => {
      loads++;
      return ENTRIES;
    },
  });
  assert.equal(authorizedCall(req(), deps).cached, false);
  assert.equal(authorizedCall(req(), deps).cached, true);
  setNow(getNow() + 61_000);
  // 注意：窗口也过期了，配额恢复，可继续调用
  const r3 = authorizedCall(req(), deps);
  assert.equal(r3.cached, false);
  assert.equal(loads, 2);
});

// ── Stale 降级 ────────────────────────────────────────────────────────────

test("数据源抛错时用快照降级（stale: true）", () => {
  const { deps } = makeDeps();
  let fail = false;
  const req = () => ({
    tool: "search_opportunities",
    args: { ...ARGS },
    ctx: CTX,
    callerKey: "2.2.2.2",
    loadEntries: () => {
      if (fail) throw new Error("D1 down");
      return ENTRIES;
    },
  });
  const r1 = authorizedCall(req(), deps);
  assert.equal(r1.stale, false);
  fail = true;
  // 换参数绕开缓存，直达数据源
  const r2 = authorizedCall(
    { ...req(), args: { direction: "脑成像", limit: 5 }, callerKey: "3.3.3.3" },
    deps,
  );
  assert.equal(r2.stale, true);
  assert.ok(typeof r2.staleAt === "number");
  assert.deepEqual(r2.value, r1.value);
});

test("stale 结果不写缓存：源恢复后即拿到新鲜数据", () => {
  const { deps } = makeDeps();
  let fail = false;
  let version = 1;
  const req = (caller) => ({
    tool: "search_opportunities",
    args: { ...ARGS },
    ctx: CTX,
    callerKey: caller,
    loadEntries: () => {
      if (fail) throw new Error("D1 down");
      return version === 1 ? ENTRIES : [...ENTRIES, entry("e3", "新机会", "2027-03-01")];
    },
  });
  const a1 = { ...ARGS };
  const a2 = { ...ARGS, limit: 6 };
  const a3 = { ...ARGS, limit: 7 };
  authorizedCall({ ...req("4.4.4.4"), args: a1 }, deps); // 快照 v1（同时写缓存 K1）
  fail = true;
  const stale = authorizedCall({ ...req("5.5.5.5"), args: a2 }, deps); // K2 未命中 → 走降级
  assert.equal(stale.stale, true);
  fail = false;
  version = 2;
  const fresh = authorizedCall({ ...req("6.6.6.6"), args: a3 }, deps); // K3 未命中 → 新鲜数据
  assert.equal(fresh.stale, false);
  assert.equal(fresh.cached, false);
  assert.equal(fresh.value.total, 3); // 若 stale 被缓存，这里会是 2
});

test("无快照时数据源抛错 → 503", () => {
  const { deps } = makeDeps();
  assertMcpError(
    () =>
      authorizedCall(
        {
          tool: "search_opportunities",
          args: { ...ARGS },
          ctx: CTX,
          callerKey: "7.7.7.7",
          loadEntries: () => {
            throw new Error("D1 down");
          },
        },
        deps,
      ),
    503,
  );
});

// ── 透传 ──────────────────────────────────────────────────────────────────

test("未知 tool / 非法参数以 400 透出，不被包装吞掉", () => {
  const { deps } = makeDeps();
  assertMcpError(
    () => authorizedCall({ tool: "nope", args: {}, ctx: CTX, callerKey: "8.8.8.8" }, deps),
    400,
  );
  assertMcpError(
    () =>
      authorizedCall(
        { tool: "search_opportunities", args: { direction: "BCI" }, ctx: CTX, callerKey: "8.8.8.9" },
        deps,
      ),
    400,
  );
});
