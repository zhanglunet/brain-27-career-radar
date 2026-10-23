/**
 * PRD-150/T2 · 求职信模板（单页 A4，T1 §2.3）。
 *
 * 版式：信头（姓名 + 联系行，同简历）→ 渲染日期 → 收件两行 → 称呼 →
 * 来意段 / 匹配段 / 佐证段 / 结尾段 → 此致敬礼 → 落款。
 *
 * 插槽来源（T1 §四对接点）：
 * - 机会字段（title/org/type/mentor）全部为公开情报（opportunity_cache 产物，
 *   T1 §4.4），允许渲染进文档；个人数据仍然零外发；
 * - 匹配段正文 = `materials` 最新 `ps` 或 `cover_letter` 草稿（T1 §4.2），
 *   由调用方传入（T4 从草稿库取），本模块只读消费、不回写；
 * - 佐证段 = experience[] 中与机会关键词命中数最高的 1–2 条（T1 §2.3）。
 */

import type { OpportunityInput } from "../../drafter.ts";
import type { JobDocProfile, JobDocExperience } from "../profile.ts";
import type { TemplateSpec, TemplateBlock, LinePart } from "./types.ts";

/**
 * 关键词命中（语义与 drafter.ts 私有 keywordHits 一致：短词跳过、
 * 纯 ASCII 关键词按词边界命中，防止 "AI" 命中 "air"）。
 */
function keywordHits(text: string, keyword: string): boolean {
  const k = keyword.toLowerCase().replace(/\s+/g, "");
  if (k.length < 2) return false;
  const t = text.toLowerCase().replace(/\s+/g, "");
  if (/^[a-z0-9]+$/.test(k)) {
    return new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(t);
  }
  return t.includes(k);
}

/** 单条经历的检索语料（title/org/highlight/tags 全算）。 */
function experienceCorpus(exp: JobDocExperience): string {
  return [exp.title, exp.org ?? "", exp.highlight, ...(exp.tags ?? [])].join(" ");
}

/** 按关键词命中数排序，取前 2 条（并列时保持档案原顺序）。 */
function topEvidence(
  profile: JobDocProfile,
  opportunity: OpportunityInput | undefined,
): string[] {
  const experience = profile.experience ?? [];
  if (experience.length === 0) return [];
  const keywords = opportunity?.keywords ?? [];
  if (keywords.length === 0) return experience.slice(0, 2).map(evidenceLine);
  const scored = experience.map((exp, i) => ({
    i,
    exp,
    hits: keywords.filter((kw) => keywordHits(experienceCorpus(exp), kw)).length,
  }));
  return scored
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .filter((s) => s.hits > 0)
    .slice(0, 2)
    .map((s) => evidenceLine(s.exp));
}

/** 佐证句：`{title}：{highlight}`（title 缺失只剩 highlight，不编造）。 */
function evidenceLine(exp: { title: string; highlight: string; org?: string }): string {
  const head = exp.title.length > 0 ? exp.title : exp.org ?? "";
  const body = exp.highlight;
  return head.length > 0 ? `${head}：${body}` : body;
}

/** 按档案 + 机会生成 cover-letter 模板块列表。 */
export function coverLetterBlocks(
  profile: JobDocProfile,
  opportunity: OpportunityInput | undefined,
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];

  // ── 信头（同简历：姓名 + 联系行）──
  blocks.push({ type: "heading", slot: "basics.name" });
  blocks.push({
    type: "contact",
    slots: ["basics.email", "basics.phone", "basics.location", "basics.homepage"],
    separator: " · ",
  });
  blocks.push({ type: "rule" });

  // ── 日期 ──
  blocks.push({ type: "date" });
  blocks.push({ type: "rule" });

  // ── 收件两行（导师缺失兜底"尊敬的老师"，T1 §2.3）──
  blocks.push({
    type: "recipient",
    parts: [
      { text: "收件：" },
      { slot: "opportunity.mentor", fallback: "尊敬的老师" },
    ],
  });
  blocks.push({
    type: "recipient",
    indent: true,
    parts: [{ slot: "opportunity.org", required: true }],
  });

  // ── 称呼（顶格，不缩进；T1 §2.3 版式）──
  blocks.push({
    type: "line",
    parts: [
      { text: "尊敬的" },
      { slot: "opportunity.mentor", fallback: "老师" },
      { text: "：" },
    ],
  });

  // ── 来意段 ──
  blocks.push({
    type: "para",
    parts: [
      { text: "您好！冒昧来信。我拟申请" },
      { slot: "opportunity.org", required: true },
      { text: "的" },
      { slot: "opportunity.title", required: true },
      { slot: "opportunity.type", prefix: "（", suffix: "）" },
      { text: "，我的研究兴趣集中在" },
      { slot: "target.researchInterests", required: true },
      { text: "方向，希望能有机会加入并继续深入相关研究。" },
    ],
  });

  // ── 匹配段（materials 最新 ps / cover_letter 草稿，调用方传入）──
  blocks.push({
    type: "para",
    parts: [{ slot: "letter.body", required: true }],
  });

  // ── 佐证段（关键词命中最高的 1–2 条经历；无经历则占位）──
  const evidence = topEvidence(profile, opportunity);
  const evidenceParts: LinePart[] =
    evidence.length > 0
      ? [{ text: `相关经历方面，${evidence.join("；")}。` }]
      : [{ slot: "experience", required: true }];
  blocks.push({ type: "para", parts: evidenceParts });

  // ── 结尾段（附件清单 + 期待回复）──
  blocks.push({
    type: "para",
    parts: [{ text: "随信附上个人简历一份，恳请查阅。期待您的回复，占用您时间非常感谢！" }],
  });

  // ── 落款 ──
  blocks.push({ type: "closing" });
  blocks.push({ type: "line", parts: [{ slot: "basics.name", required: true }] });

  return blocks;
}

/** cover-letter 模板规格（产物 kind = cover_letter，T1 §4.2 新增 DraftKind 值）。 */
export function coverLetterTemplate(
  profile: JobDocProfile,
  opportunity: OpportunityInput | undefined,
): TemplateSpec {
  return {
    id: "cover-letter",
    kind: "cover_letter",
    title: "中文求职信（一页）",
    blocks: coverLetterBlocks(profile, opportunity),
  };
}
