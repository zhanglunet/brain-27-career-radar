import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMentors,
  findRelated,
  attachRelated,
  DEFAULT_PER_LANE_CAP,
  DEFAULT_TOTAL_CAP,
} from "../lib/wiki/linking.ts";

let seq = 0;
function mkEntry(over) {
  seq += 1;
  return {
    id: over.id ?? `e${seq}`,
    title: over.title ?? "测试条目",
    source: "测试来源",
    source_url: "https://example.com/x",
    source_type: "daily_report",
    d1_evidence: null,
    confidence: "medium",
    created: "2026-10-01",
    last_verified: over.last_verified ?? "2026-10-10",
    status: "active",
    facets: { keywords: [] },
    body: over.body ?? "正文。",
    ...over,
  };
}

// ── extractMentors ────────────────────────────────────────────────────────

test("extractMentors：导师/PI/教授中文名", () => {
  assert.deepEqual(extractMentors("招生", "导师张三，方向脑机接口。"), ["张三"]);
  assert.deepEqual(extractMentors("招生", "PI 李四 课题组招博士。"), ["李四"]);
  assert.deepEqual(extractMentors("王五教授团队", "正文。"), ["王五"]);
});

test("extractMentors：无提及 → 空数组，不编造", () => {
  assert.deepEqual(extractMentors("UCL 博士招生", "欢迎申请，无导师信息。"), []);
});

test("extractMentors：多导师取数组，去重保序", () => {
  const r = extractMentors("招生", "导师张三、导师李四，PI 张三。");
  assert.deepEqual(r, ["张三", "李四"]);
});

test("extractMentors：停用词不误抓（实验室教授）", () => {
  const r = extractMentors("招生", "神经科学实验室教授团队招人。");
  assert.ok(!r.includes("实验室"), `误抓: ${r}`);
});

test("extractMentors：英文名 PI John Smith", () => {
  assert.deepEqual(extractMentors("招生", "PI John Smith lab hiring."), ["John Smith"]);
});

// ── 同机构 ────────────────────────────────────────────────────────────────

test("findRelated：同机构命中（归一化 UCL=伦敦大学学院）", () => {
  const orgOf = (e) => e.org;
  const hist = [
    mkEntry({ id: "h1", title: "UCL 旧博士项目", org: "伦敦大学学院", last_verified: "2026-09-01" }),
    mkEntry({ id: "h2", title: "MIT 旧项目", org: "MIT", last_verified: "2026-09-02" }),
  ];
  const links = findRelated(mkEntry({ id: "new", title: "UCL 新博士", org: "UCL" }), hist, { orgOf });
  assert.equal(links.length, 1);
  assert.equal(links[0].id, "h1");
  assert.equal(links[0].relation, "same_org");
  assert.deepEqual(links[0].matchedOn, ["ucl"]);
});

test("findRelated：无 orgOf → 同机构一路为空（fail-safe）", () => {
  const hist = [mkEntry({ id: "h1", title: "旧项目" })];
  const links = findRelated(mkEntry({ id: "new", title: "新项目" }), hist, {});
  assert.deepEqual(links, []);
});

// ── 同领域 ────────────────────────────────────────────────────────────────

test("findRelated：同领域命中（关键词交集）", () => {
  const hist = [
    mkEntry({ id: "h1", title: "旧 A", facets: { keywords: ["脑机接口", "EEG"] }, last_verified: "2026-09-01" }),
    mkEntry({ id: "h2", title: "旧 B", facets: { keywords: ["机器人"] }, last_verified: "2026-09-02" }),
  ];
  const links = findRelated(
    mkEntry({ id: "new", title: "新", facets: { keywords: ["脑机接口"] } }),
    hist,
    {},
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].id, "h1");
  assert.equal(links[0].relation, "same_field");
  assert.deepEqual(links[0].matchedOn, ["脑机接口"]);
});

// ── 同导师 ────────────────────────────────────────────────────────────────

test("findRelated：同导师命中（mentorOf 访问器）", () => {
  const mentorOf = (e) => e.mentors ?? [];
  const hist = [
    mkEntry({ id: "h1", title: "旧 A", mentors: ["张三"] }),
    mkEntry({ id: "h2", title: "旧 B", mentors: ["李四"] }),
  ];
  const links = findRelated(mkEntry({ id: "new", title: "新", mentors: ["张三", "王五"] }), hist, { mentorOf });
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "same_mentor");
  assert.deepEqual(links[0].matchedOn, ["张三"]);
});

test("findRelated：缺省 mentorOf → 用 extractMentors 从正文提取", () => {
  const hist = [mkEntry({ id: "h1", title: "旧", body: "导师张三团队。" })];
  const links = findRelated(mkEntry({ id: "new", title: "新", body: "导师张三招生。" }), hist, {});
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "same_mentor");
});

test("findRelated：新条目无导师 → 导师一路为空，其他路不受影响", () => {
  const mentorOf = (e) => e.mentors ?? [];
  const hist = [mkEntry({ id: "h1", title: "旧", mentors: ["张三"], facets: { keywords: ["脑机接口"] } })];
  const links = findRelated(
    mkEntry({ id: "new", title: "新", mentors: [], facets: { keywords: ["脑机接口"] } }),
    hist,
    { mentorOf },
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].relation, "same_field");
});

// ── 纪律：不改历史、排除自身 ───────────────────────────────────────────────

test("findRelated+attachRelated：历史条目绝不被修改", () => {
  const orgOf = (e) => e.org;
  const hist = [
    mkEntry({ id: "h1", title: "UCL 旧项目", org: "UCL", facets: { keywords: ["脑机接口"] } }),
  ];
  const before = JSON.stringify(hist);
  const links = findRelated(
    mkEntry({ id: "new", title: "UCL 新项目", org: "UCL", facets: { keywords: ["脑机接口"] } }),
    hist,
    { orgOf },
  );
  const attached = attachRelated(mkEntry({ id: "new", title: "n" }), links);
  assert.equal(JSON.stringify(hist), before);
  assert.ok(!("related" in hist[0]));
  assert.ok(Array.isArray(attached.related));
});

test("findRelated：自身（同 id）永远排除", () => {
  const orgOf = (e) => e.org;
  const hist = [mkEntry({ id: "new", title: "就是我", org: "UCL" })];
  const links = findRelated(mkEntry({ id: "new", title: "就是我", org: "UCL" }), hist, { orgOf });
  assert.deepEqual(links, []);
});

// ── 多路去重与排序、上限 ──────────────────────────────────────────────────

test("findRelated：多路命中同一条目 → 只留一条，relation 取最强一路，证据累加", () => {
  const orgOf = (e) => e.org;
  const hist = [mkEntry({ id: "h1", title: "UCL 旧项目", org: "UCL", facets: { keywords: ["脑机接口"] } })];
  const links = findRelated(
    mkEntry({ id: "new", title: "UCL 新项目", org: "UCL", facets: { keywords: ["脑机接口"] } }),
    hist,
    { orgOf },
  );
  assert.equal(links.length, 1);
  // same_org(1) 强于 same_field(2)
  assert.equal(links[0].relation, "same_org");
  assert.ok(links[0].matchedOn.includes("ucl"));
  assert.ok(links[0].matchedOn.includes("脑机接口"));
});

test("findRelated：每路上限 + 最新优先", () => {
  const orgOf = (e) => e.org;
  const hist = [];
  for (let i = 1; i <= 8; i++) {
    hist.push(
      mkEntry({
        id: `h${i}`,
        title: `旧 ${i}`,
        org: "UCL",
        last_verified: `2026-09-${String(i).padStart(2, "0")}`,
      }),
    );
  }
  const links = findRelated(mkEntry({ id: "new", title: "新", org: "UCL" }), hist, {
    orgOf,
    perLaneCap: 3,
  });
  assert.equal(links.length, 3);
  // 最新优先：h8, h7, h6
  assert.deepEqual(links.map((l) => l.id), ["h8", "h7", "h6"]);
});

test("findRelated：总上限截断", () => {
  const orgOf = (e) => e.org;
  const mentorOf = (e) => e.mentors ?? [];
  const hist = [];
  for (let i = 1; i <= 12; i++) {
    hist.push(
      mkEntry({
        id: `h${i}`,
        title: `旧 ${i}`,
        org: "UCL",
        mentors: ["张三"],
        last_verified: `2026-09-${String(i).padStart(2, "0")}`,
      }),
    );
  }
  const links = findRelated(
    mkEntry({ id: "new", title: "新", org: "UCL", mentors: ["张三"] }),
    hist,
    { orgOf, mentorOf, perLaneCap: 12, totalCap: 4 },
  );
  assert.equal(links.length, 4);
});

test("findRelated：默认上限常量", () => {
  assert.equal(DEFAULT_PER_LANE_CAP, 5);
  assert.equal(DEFAULT_TOTAL_CAP, 10);
});

// ── attachRelated ─────────────────────────────────────────────────────────

test("attachRelated：返回新对象，不修改原条目", () => {
  const entry = mkEntry({ id: "new", title: "新" });
  const before = JSON.stringify(entry);
  const out = attachRelated(entry, [{ id: "h1", title: "旧", relation: "same_org", matchedOn: ["ucl"] }]);
  assert.equal(JSON.stringify(entry), before);
  assert.notEqual(out, entry);
  assert.equal(out.related.length, 1);
  assert.equal(out.id, "new");
});
