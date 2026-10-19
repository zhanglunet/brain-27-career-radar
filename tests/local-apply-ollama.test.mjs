import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_DRAFT_MARKER,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  OllamaUnavailable,
  assertLoopback,
  createOllamaClient,
} from "../lib/local-apply/ollama.ts";

/** 记录所有被调用 URL 的 fake fetch。 */
function makeFakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init || {});
  };
  fn.calls = calls;
  return fn;
}

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function fixtureResult() {
  return {
    opportunityId: "opp-oxford-ra",
    score: 0.7,
    dimensions: [
      { dimension: "direction", score: 0.8, weight: 0.5, reasons: ["兴趣命中脑机接口"] },
      { dimension: "mentor", score: 0.5, weight: 0.3, reasons: ["未标注导师，中性"] },
      { dimension: "requirements", score: 0.6, weight: 0.2, reasons: ["学历符合"] },
    ],
    gaps: ["缺 EEG 经验"],
    summary: "方向对，导师未知",
    ruleVersion: "0.1.0",
  };
}

function fixtureCtx() {
  return {
    opportunity: { id: "opp-oxford-ra", title: "牛津大学脑机接口 RA" },
    profile: {
      degree: "实验心理学硕士",
      researchInterests: ["脑机接口"],
      skills: ["Python"],
    },
  };
}

test("OLL-1 · 可用性检查：Ollama 在线时返回模型列表", async () => {
  const fetchFn = makeFakeFetch((url) => {
    assert.ok(url.endsWith("/api/tags"), "应请求 /api/tags");
    return okJson({ models: [{ name: "qwen2.5:7b" }, { name: "llama3.1:8b" }] });
  });
  const client = createOllamaClient({ fetchFn });
  const r = await client.checkAvailability();
  assert.equal(r.available, true);
  assert.deepEqual(r.models, ["qwen2.5:7b", "llama3.1:8b"]);
});

test("OLL-2 · 可用性检查：连不上时返回 available=false（不抛错）", async () => {
  const fetchFn = makeFakeFetch(() => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  });
  const client = createOllamaClient({ fetchFn });
  const r = await client.checkAvailability();
  assert.equal(r.available, false);
  assert.deepEqual(r.models, []);
});

test("OLL-3 · rerank 形状兼容 LlmRerankFn：返回同 shape 的 MatchResult", async () => {
  const fetchFn = makeFakeFetch((url) =>
    okJson({
      response: '{"direction": 0.9, "mentor": 0.4, "requirements": 0.6, "note": "方向很对"}',
    }),
  );
  const client = createOllamaClient({ fetchFn });
  const out = await client.rerank(fixtureResult(), fixtureCtx());
  assert.equal(out.opportunityId, "opp-oxford-ra");
  assert.equal(out.dimensions.length, 3);
  assert.equal(out.dimensions[0].score, 0.9);
  assert.equal(out.dimensions[1].score, 0.4);
  assert.equal(out.dimensions[2].score, 0.6);
  // 加权总分按用户拍板的权重重算：0.9*0.5+0.4*0.3+0.6*0.2 = 0.69
  assert.equal(out.score, 0.69);
  // 每维度保留原理由并追加 LLM 复核
  for (const d of out.dimensions) {
    assert.ok(d.reasons.length >= 2, "应追加 LLM 复核理由");
  }
  assert.ok(out.dimensions[0].reasons.some((r) => r.includes("方向很对")));
});

test("OLL-4 · rerank 解析失败时原样返回（不瞎改分）", async () => {
  const fetchFn = makeFakeFetch(() => okJson({ response: "抱歉我没理解" }));
  const client = createOllamaClient({ fetchFn });
  const input = fixtureResult();
  const out = await client.rerank(input, fixtureCtx());
  assert.deepEqual(out, input);
});

test("OLL-5 · polish 输出强制保留 AI 标注（LLM 吞掉也补回）", async () => {
  const fetchFn = makeFakeFetch(() =>
    okJson({ response: "润色后的正文，没有任何标注。" }),
  );
  const client = createOllamaClient({ fetchFn });
  const out = await client.polish("原始草稿", {
    kind: "ps",
    opportunityId: "opp-oxford-ra",
  });
  assert.ok(out.includes(AI_DRAFT_MARKER), "必须含 AI 草稿标注");
  assert.ok(out.includes("润色后的正文"));
});

test("OLL-6 · polish 保留 LLM 自带的标注（不重复）", async () => {
  const fetchFn = makeFakeFetch(() =>
    okJson({ response: `> ⚠️ ${AI_DRAFT_MARKER}\n\n润色正文。` }),
  );
  const client = createOllamaClient({ fetchFn });
  const out = await client.polish("原始草稿", {
    kind: "email",
    opportunityId: "opp-x",
  });
  const count = out.split(AI_DRAFT_MARKER).length - 1;
  assert.equal(count, 1, "标注不应重复");
});

test("OLL-7 · Ollama 不可用时抛 OllamaUnavailable（类型化错误）", async () => {
  const fetchFn = makeFakeFetch(() => {
    throw new Error("connect ECONNREFUSED");
  });
  const client = createOllamaClient({ fetchFn });
  await assert.rejects(() => client.generate("hi"), OllamaUnavailable);
  await assert.rejects(
    () => client.rerank(fixtureResult(), fixtureCtx()),
    OllamaUnavailable,
  );
  await assert.rejects(
    () => client.polish("x", { kind: "cv", opportunityId: "o" }),
    OllamaUnavailable,
  );
});

test("OLL-8 · 非 200 也抛 OllamaUnavailable", async () => {
  const fetchFn = makeFakeFetch(() => ({ ok: false, status: 500 }));
  const client = createOllamaClient({ fetchFn });
  await assert.rejects(() => client.generate("hi"), OllamaUnavailable);
});

test("OLL-9 · 超时后抛 OllamaUnavailable（不 hanging）", async () => {
  const fetchFn = makeFakeFetch(
    (url, init) =>
      new Promise((_, reject) => {
        // 模拟真实 fetch：abort signal 触发时 reject
        if (init.signal) {
          if (init.signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
        // 否则永不 resolve（模拟卡死的 Ollama）
      }),
  );
  const client = createOllamaClient({ fetchFn, timeoutMs: 50 });
  await assert.rejects(() => client.generate("hi"), OllamaUnavailable);
});

test("OLL-10 · 非 loopback 的 OLLAMA_HOST 直接拒绝构造", () => {
  for (const bad of [
    "http://192.168.1.10:11434",
    "https://api.openai.com",
    "http://example.com:11434",
  ]) {
    assert.throws(
      () => createOllamaClient({ host: bad, fetchFn: makeFakeFetch(() => okJson({})) }),
      /loopback/,
      bad,
    );
  }
  // 合法的 loopback 写法都通过
  for (const good of [
    "http://127.0.0.1:11434",
    "http://localhost:11434",
    "http://[::1]:11434",
  ]) {
    const c = createOllamaClient({
      host: good,
      fetchFn: makeFakeFetch(() => okJson({})),
    });
    assert.ok(c.host.includes("127.0.0.1") || c.host.includes("localhost") || c.host.includes("[::1]"));
  }
});

test("OLL-11 · 永不构造非 localhost URL（无云端回退）", async () => {
  const fetchFn = makeFakeFetch((url) => {
    if (url.endsWith("/api/tags")) return okJson({ models: [] });
    return okJson({ response: '{"direction": 0.5, "mentor": 0.5, "requirements": 0.5, "note": ""}' });
  });
  const client = createOllamaClient({ fetchFn });
  await client.checkAvailability();
  await client.generate("hi");
  await client.rerank(fixtureResult(), fixtureCtx());
  await client.polish("草稿", { kind: "ps", opportunityId: "o" });
  assert.ok(fetchFn.calls.length > 0, "应有请求发出");
  for (const url of fetchFn.calls) {
    const host = new URL(url).hostname.toLowerCase();
    assert.ok(
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host),
      `非本机 URL 被构造：${url}`,
    );
  }
});

test("OLL-12 · 默认值：host/model 符合 T1 §3.1", () => {
  const client = createOllamaClient({
    fetchFn: makeFakeFetch(() => okJson({})),
  });
  assert.equal(client.host, DEFAULT_OLLAMA_HOST);
  assert.equal(client.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(DEFAULT_OLLAMA_MODEL, "qwen2.5:7b");
});

test("OLL-13 · assertLoopback 单元测试", () => {
  assert.equal(assertLoopback("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  assert.throws(() => assertLoopback("not-a-url"), /非法/);
  assert.throws(() => assertLoopback("ftp://127.0.0.1/x"), /协议/);
});
