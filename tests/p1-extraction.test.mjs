import assert from "node:assert/strict";
import test from "node:test";
import { getAdapter } from "../lib/p1/adapters.ts";
import { decideOpportunityChange } from "../lib/p1/decision.ts";
import { canonicalizeUrl } from "../lib/p1/url.ts";

test("canonicalizeUrl removes tracking while preserving business parameters", () => {
  assert.equal(
    canonicalizeUrl("http://www.example.com/jobs/?utm_source=news&recruitType=Intern#top"),
    "https://example.com/jobs?recruitType=Intern",
  );
  assert.equal(canonicalizeUrl("mailto:test@example.com"), null);
});

test("OPPO detail adapter extracts structured fields with evidence", () => {
  const adapter = getAdapter("oppo-job-detail");
  assert.ok(adapter);
  const html = `
    <html><head><title>健康算法工程师 | OPPO</title>
    <script type="application/ld+json">{
      "@type":"JobPosting",
      "title":"健康算法工程师",
      "url":"https://careers.oppo.com/university/oppo/campus/post/1611?utm_source=test&recruitType=Graduate",
      "validThrough":"2026-09-12",
      "jobLocation":{"addressLocality":"深圳"}
    }</script></head><body><h1>健康算法工程师</h1><p>2027 届实习正在招聘，工作地点深圳。</p></body></html>`;
  const [candidate] = adapter.extract({
    sourceId: "oppo-health-algorithm",
    sourceName: "OPPO 健康算法岗位",
    sourceUrl: "https://careers.oppo.com/jobs/1611",
    finalUrl: "https://careers.oppo.com/jobs/1611",
    sourceType: "detail",
    adapterKey: "oppo-job-detail",
    html,
  });

  assert.equal(candidate.title, "健康算法工程师");
  assert.equal(candidate.org, "OPPO");
  assert.equal(candidate.kind, "实习");
  assert.equal(candidate.location, "深圳");
  assert.equal(candidate.deadline, "2026-09-12");
  assert.equal(candidate.status, "立即行动");
  assert.equal(candidate.canonicalUrl, "https://careers.oppo.com/university/oppo/campus/post/1611?recruitType=Graduate");
  assert.ok(candidate.evidence.some((item) => item.fieldName === "deadline" && item.confidence >= 70));
});

test("listing adapter discovers relevant same-site links and deduplicates URLs", () => {
  const adapter = getAdapter("career-listing");
  assert.ok(adapter);
  const candidates = adapter.extract({
    sourceId: "brainco-recruit",
    sourceName: "BrainCo 招聘",
    sourceUrl: "https://www.brainco.tech/recruit",
    finalUrl: "https://www.brainco.tech/recruit",
    sourceType: "listing",
    adapterKey: "career-listing",
    html: `<a href="/jobs/bci?utm_source=a">脑机接口算法实习生</a>
      <a href="https://brainco.tech/jobs/bci">脑机接口算法实习生</a>
      <a href="/about">关于我们</a>
      <a href="https://external.test/jobs">神经算法岗位</a>`,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonicalUrl, "https://brainco.tech/jobs/bci");
  assert.equal(candidates[0].kind, "实习");
});

test("listing adapter classifies research assistant roles separately", () => {
  const adapter = getAdapter("career-listing");
  assert.ok(adapter);
  const [candidate] = adapter.extract({
    sourceId: "shlab-jobs",
    sourceName: "高校科研岗位",
    sourceUrl: "https://www.shlab.org.cn/joinus",
    finalUrl: "https://www.shlab.org.cn/joinus",
    sourceType: "listing",
    adapterKey: "career-listing",
    html: `<a href="/joinus/research-assistant">Research Assistant in Cognitive Neuroscience</a>`,
  });

  assert.equal(candidate.kind, "科研助理");
});

test("listing adapter rejects template expressions and generic navigation", () => {
  const adapter = getAdapter("career-listing");
  assert.ok(adapter);
  const candidates = adapter.extract({
    sourceId: "shlab-jobs",
    sourceName: "上海人工智能实验室招聘",
    sourceUrl: "https://www.shlab.org.cn/joinus",
    finalUrl: "https://www.shlab.org.cn/joinus",
    sourceType: "listing",
    adapterKey: "career-listing",
    html: `<a href="${'${ v.url }'}">${'${ v.tags }'}</a>
      <a href="/joinus/social">社会招聘和校园招聘</a>
      <a href="/joinus/social?location=CT_11">查看岗位列表</a>
      <a href="/research">科学研究</a>
      <a href="/open?tab=algorithm">算法</a>`,
  });
  assert.deepEqual(candidates, []);
});

test("detail adapter falls back from generic page title and ignores publication dates", () => {
  const adapter = getAdapter("academic-detail");
  assert.ok(adapter);
  const [candidate] = adapter.extract({
    sourceId: "tsinghua-pcs",
    sourceName: "清华大学心理与认知科学系招生",
    sourceUrl: "https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm",
    finalUrl: "https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm",
    sourceType: "detail",
    adapterKey: "academic-detail",
    html: `<html><head><title>新闻动态</title></head><body><h1>新闻动态</h1><p>发布时间：2026-7-1。博士招生简章。</p></body></html>`,
  });
  assert.equal(candidate.title, "清华大学心理与认知科学系招生");
  assert.equal(candidate.deadline, null);
});

test("change decision sends deadline changes to high-risk review", () => {
  const decision = decideOpportunityChange({
    canonicalUrl: "https://example.test/job",
    title: "脑机接口算法实习生",
    org: "Example Lab",
    kind: "实习",
    location: "上海",
    deadline: "2026-10-01",
    status: "立即行动",
    evidence: [],
    metadata: {},
  }, {
    id: "job-1",
    name: "脑机接口算法实习生",
    org: "Example Lab",
    kind: "实习",
    location: "上海",
    deadline: "2026-09-01",
    status: "立即行动",
    url: "https://example.test/job",
  });

  assert.equal(decision?.riskLevel, "high");
  assert.deepEqual(decision?.changedFields, ["deadline"]);
  assert.deepEqual(decision?.patch, { deadline: "2026-10-01" });
});

test("URL-only changes are classified as low risk", () => {
  const decision = decideOpportunityChange({
    canonicalUrl: "https://example.test/job-new",
    title: "研究岗位",
    org: "Example Lab",
    kind: "研究岗位",
    location: "北京",
    deadline: null,
    status: "持续关注",
    evidence: [],
    metadata: {},
  }, {
    id: "job-1",
    name: "研究岗位",
    org: "Example Lab",
    kind: "研究岗位",
    location: "北京",
    deadline: "长期有效",
    status: "持续关注",
    url: "https://example.test/job-old",
  });

  assert.equal(decision?.riskLevel, "low");
  assert.deepEqual(decision?.patch, { url: "https://example.test/job-new" });
});
