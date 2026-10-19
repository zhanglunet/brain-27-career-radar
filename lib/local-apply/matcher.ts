/**
 * PRD-080/T2 · 岗位匹配度评估（本地，trend #393）。
 *
 * v0.1 纯规则版：三维度加权打分 + 缺口分析，全部可解释。
 * 权重（用户 2026-10-19 拍板，方向优先版）：研究方向 0.5 / 导师匹配 0.3 /
 * 申请条件符合度 0.2。T2 不得擅自修改权重。
 *
 * ── 数据主权红线 ─────────────────────────────────────────────
 * 本模块是纯函数：只接受参数（机会 + 本地档案），不做任何网络请求、
 * 不读写磁盘、不打印个人档案内容。个人数据进函数、出结果，不落地、不上云。
 * LLM 重排是预留钩子（LlmRerankFn 类型），默认不启用；T1 设计 §三-3.2：
 * 云端 LLM 处理个人材料必须用户逐次授权，本模块不内置任何 LLM 调用。
 * ────────────────────────────────────────────────────────────
 *
 * 约定：只用可擦除 TypeScript 语法（无 enum / namespace），
 * `node --test` 可直接运行。
 */

import type {
  WikiOpportunityType,
  WikiRegion,
  WikiFunding,
} from "../wiki/schema.ts";
import { WIKI_DIRECTIONS } from "../mcp/tools.ts";

/** 维度权重（用户已定；T2 不得擅自修改）。 */
export const MATCH_WEIGHTS = {
  direction: 0.5,
  mentor: 0.3,
  requirements: 0.2,
} as const;

export const MATCH_RULE_VERSION = "0.1.0";

export type DimensionId = "direction" | "mentor" | "requirements";

/**
 * 机会侧输入：T1 设计 §4.2 白名单字段的子集（全部为公开情报）。
 * 调用方（如 CLI）负责从 PRD-018 只读 MCP / 摘要 API 取数并映射到本类型。
 */
export type MatchOpportunity = {
  id: string;
  title: string;
  org?: string;
  type?: WikiOpportunityType;
  region?: WikiRegion;
  funding?: WikiFunding;
  /** ISO 日期；缺失表示未知。 */
  deadline?: string | null;
  /** detail 下钻正文（可选）。 */
  body?: string;
  /** facets.keywords（PRD-061 归类产出）。 */
  keywords?: string[];
  /** 导师名（PRD-061 T1 预留的 mentor 字段；可用 linking.ts extractMentors 提取）。 */
  mentors?: string[];
  /** 申请条件条目（如 "硕士学历"），来自 detail 下钻。 */
  requirements?: string[];
};

/** 本地用户档案：绝不出机器（T1 设计 §二-#4/#5）。 */
export type LocalProfile = {
  /** 当前学历，如 "实验心理学硕士"。 */
  degree: string;
  /** 研究兴趣关键词，如 ["脑机接口", "认知神经科学"]。 */
  researchInterests: string[];
  /** 技能关键词，如 ["Python", "EEG 信号处理"]。 */
  skills: string[];
  /** 感兴趣的导师名（可选）。 */
  mentorsOfInterest?: string[];
  /** 意向地区（可选；不填则该项不扣分）。 */
  targetRegions?: WikiRegion[];
  /** 意向机会类型（可选；不填则该项不扣分）。 */
  targetTypes?: WikiOpportunityType[];
  /** 资助需求：full=必须全奖，partial=可接受部分，any=无要求（默认）。 */
  fundingNeed?: "full" | "partial" | "any";
};

export type DimensionScore = {
  dimension: DimensionId;
  /** 0–1。 */
  score: number;
  weight: number;
  /** 可解释理由，恒 ≥1 条。 */
  reasons: string[];
};

export type MatchResult = {
  opportunityId: string;
  /** 0–1，加权总分（保留 3 位小数）。 */
  score: number;
  dimensions: DimensionScore[];
  /** 缺口分析：缺什么经历/技能/材料。 */
  gaps: string[];
  /** 一句话总结。 */
  summary: string;
  ruleVersion: string;
};

export type MatchOptions = {
  /** "现在"，用于截止日判断；默认 new Date()。测试请传固定值。 */
  now?: Date;
};

/**
 * LLM 重排钩子（预留，T2 范围外）。
 * 调用方自行实现；注意红线：只能发往本地 LLM（localhost），
 * 云端 LLM 需用户逐次授权（T1 设计 §三-3.2）。
 */
export type LlmRerankFn = (
  result: MatchResult,
  ctx: { opportunity: MatchOpportunity; profile: LocalProfile },
) => Promise<MatchResult>;

// ── 小工具 ───────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function normList(xs: readonly string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const t = norm(x);
    if (t) out.push(t);
  }
  return out;
}

/** 命中判定：相等或任一包含另一（v0.1 启发式，见模块尾注）。 */
function hit(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

function dim(id: DimensionId, score: number, reasons: string[]): DimensionScore {
  return { dimension: id, score: round3(score), weight: MATCH_WEIGHTS[id], reasons };
}

// ── 维度 1：研究方向（0.5）────────────────────────────────────

function scoreDirection(
  opp: MatchOpportunity,
  profile: LocalProfile,
): { score: DimensionScore; gaps: string[] } {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const rawInterests = profile.researchInterests ?? [];
  const interests = normList(rawInterests);
  if (interests.length === 0) {
    reasons.push("未填写研究兴趣，方向维度按中性 0.5 计（建议补全本地档案）");
    return { score: dim("direction", 0.5, reasons), gaps };
  }
  const oppText = norm([opp.title, opp.body ?? ""].join(" "));
  const oppTerms = new Set<string>([
    ...normList(opp.keywords ?? []),
    ...WIKI_DIRECTIONS.filter((d) => oppText.includes(norm(d))).map((d) =>
      norm(d),
    ),
  ]);
  const hits: string[] = [];
  const missed: string[] = [];
  rawInterests.forEach((raw, i) => {
    const t = interests[i];
    const h = oppText.includes(t) || [...oppTerms].some((o) => hit(t, o));
    if (h) hits.push(raw);
    else missed.push(raw);
  });
  const score = hits.length / interests.length;
  if (hits.length === interests.length) {
    reasons.push(`研究方向全命中（${hits.length}/${interests.length}）：${hits.join("、")}`);
  } else if (hits.length > 0) {
    reasons.push(`研究方向部分命中（${hits.length}/${interests.length}）：${hits.join("、")}`);
  } else {
    reasons.push(`研究兴趣（${rawInterests.join("、")}）在机会标题/正文/关键词中均未出现`);
  }
  for (const t of missed) gaps.push(`方向缺口：你的兴趣「${t}」在该机会中未体现`);
  return { score: dim("direction", score, reasons), gaps };
}

// ── 维度 2：导师匹配（0.3）────────────────────────────────────

function scoreMentor(
  opp: MatchOpportunity,
  profile: LocalProfile,
): { score: DimensionScore; gaps: string[] } {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const oppMentors = opp.mentors ?? [];
  const wanted = profile.mentorsOfInterest ?? [];
  if (oppMentors.length === 0) {
    reasons.push("机会未标注导师信息，导师维度按中性 0.5 计");
    return { score: dim("mentor", 0.5, reasons), gaps };
  }
  if (wanted.length === 0) {
    reasons.push(`机会导师：${oppMentors.join("、")}；你未填写关注导师，按中性 0.5 计`);
    return { score: dim("mentor", 0.5, reasons), gaps };
  }
  const nOpp = normList(oppMentors);
  const nWant = normList(wanted);
  const hits: string[] = [];
  const missed: string[] = [];
  wanted.forEach((w, i) => {
    if (nOpp.some((o) => hit(nWant[i], o))) hits.push(w);
    else missed.push(w);
  });
  const score = hits.length / wanted.length;
  if (hits.length > 0) {
    reasons.push(`导师命中（${hits.length}/${wanted.length}）：${hits.join("、")}`);
  } else {
    reasons.push(`你关注的导师（${wanted.join("、")}）均未出现在该机会中`);
  }
  for (const w of missed) gaps.push(`导师缺口：你关注的「${w}」不在该机会中`);
  return { score: dim("mentor", score, reasons), gaps };
}

// ── 维度 3：申请条件符合度（0.2）──────────────────────────────

type ReqCheck = { pass: boolean; reason: string; gap?: string };

function checkRequirements(
  opp: MatchOpportunity,
  profile: LocalProfile,
  now: Date,
): ReqCheck[] {
  const checks: ReqCheck[] = [];

  // 1. 机会类型
  const wantTypes = profile.targetTypes ?? [];
  if (wantTypes.length === 0) {
    checks.push({ pass: true, reason: "未限定意向机会类型，类型项不扣分" });
  } else if (!opp.type) {
    checks.push({ pass: true, reason: "机会未标注类型，类型项不扣分（建议人工核实）" });
  } else if (wantTypes.includes(opp.type)) {
    checks.push({ pass: true, reason: `机会类型 ${opp.type} 在你的意向类型中` });
  } else {
    checks.push({
      pass: false,
      reason: `机会类型为 ${opp.type}，不在你的意向（${wantTypes.join("、")}）中`,
      gap: `类型不匹配：机会为 ${opp.type}`,
    });
  }

  // 2. 地区
  const wantRegions = profile.targetRegions ?? [];
  if (wantRegions.length === 0) {
    checks.push({ pass: true, reason: "未限定意向地区，地区项不扣分" });
  } else if (!opp.region) {
    checks.push({ pass: true, reason: "机会未标注地区，地区项不扣分（建议人工核实）" });
  } else if (wantRegions.includes(opp.region)) {
    checks.push({ pass: true, reason: `地区 ${opp.region} 在你的意向地区中` });
  } else {
    checks.push({
      pass: false,
      reason: `地区为 ${opp.region}，不在你的意向（${wantRegions.join("、")}）中`,
      gap: `地区不匹配：机会在 ${opp.region}`,
    });
  }

  // 3. 资助
  const need = profile.fundingNeed ?? "any";
  if (need === "any") {
    checks.push({ pass: true, reason: "对资助无硬性要求" });
  } else if (!opp.funding) {
    checks.push({ pass: true, reason: "机会未标注资助信息，资助项不扣分（建议人工核实）" });
  } else if (need === "full" && opp.funding === "full") {
    checks.push({ pass: true, reason: "全奖，满足你的资助需求" });
  } else if (need === "full") {
    checks.push({
      pass: false,
      reason: `你需要全奖，该机会资助为 ${opp.funding}`,
      gap: `资助不满足：需要全奖，机会为 ${opp.funding}`,
    });
  } else if (opp.funding === "full" || opp.funding === "partial" || opp.funding === "mixed") {
    checks.push({ pass: true, reason: `资助 ${opp.funding}，满足你的部分奖学金需求` });
  } else {
    checks.push({
      pass: false,
      reason: `你需要至少部分奖学金，该机会资助为 ${opp.funding}`,
      gap: `资助不满足：需要至少部分奖学金，机会为 ${opp.funding}`,
    });
  }

  // 4. 截止日
  if (!opp.deadline) {
    checks.push({ pass: true, reason: "未标注截止日，时间项不扣分（建议人工确认）" });
  } else {
    const dl = new Date(opp.deadline);
    if (Number.isNaN(dl.getTime())) {
      checks.push({ pass: true, reason: `截止日「${opp.deadline}」无法解析，时间项不扣分` });
    } else if (dl.getTime() >= now.getTime()) {
      checks.push({ pass: true, reason: `截止日 ${opp.deadline}，尚未过期` });
    } else {
      checks.push({
        pass: false,
        reason: `已过截止日（${opp.deadline}）`,
        gap: `已过截止日：${opp.deadline}`,
      });
    }
  }

  // 5. 学位门槛（v0.1 关键词启发式）
  const reqs = normList(opp.requirements ?? []);
  const degree = norm(profile.degree);
  const needsPhd = reqs.some(
    (r) => r.includes("博士") || r.includes("phd") || r.includes("doctoral"),
  );
  const needsMaster = reqs.some((r) => r.includes("硕士") || r.includes("master"));
  if (reqs.length === 0) {
    checks.push({ pass: true, reason: "机会未列出申请条件，门槛项不扣分" });
  } else if (needsPhd && !degree.includes("博士")) {
    checks.push({
      pass: false,
      reason: `要求博士学位，你当前为${profile.degree}`,
      gap: `学历门槛：要求博士学位（你当前：${profile.degree}）`,
    });
  } else if (needsPhd) {
    checks.push({ pass: true, reason: "学历符合（要求博士学位）" });
  } else if (
    needsMaster &&
    (degree.includes("硕士") || degree.includes("博士"))
  ) {
    checks.push({ pass: true, reason: "学历符合（要求硕士以上）" });
  } else if (needsMaster) {
    checks.push({
      pass: false,
      reason: `要求硕士以上学历，你当前为${profile.degree}`,
      gap: `学历门槛：要求硕士以上（你当前：${profile.degree}）`,
    });
  } else {
    checks.push({ pass: true, reason: "申请条件中未发现学历硬门槛" });
  }

  return checks;
}

function scoreRequirements(
  opp: MatchOpportunity,
  profile: LocalProfile,
  now: Date,
): { score: DimensionScore; gaps: string[] } {
  const checks = checkRequirements(opp, profile, now);
  const passed = checks.filter((c) => c.pass).length;
  const score = checks.length === 0 ? 1 : passed / checks.length;
  const reasons = checks.map((c) => (c.pass ? "✓ " : "✗ ") + c.reason);
  const gaps = checks.filter((c) => c.gap).map((c) => c.gap as string);
  return {
    score: dim("requirements", score, reasons),
    gaps,
  };
}

// ── 主入口 ─────────────────────────────────────────────────────

/**
 * 评估一个机会与本地档案的匹配度（纯函数，同步，无副作用）。
 *
 * @param opp 机会（公开情报，T1 §4.2 白名单字段）
 * @param profile 本地档案（绝不出机器）
 * @param options.now "现在"（截止日判断用；测试请传固定值）
 */
export function matchOpportunity(
  opp: MatchOpportunity,
  profile: LocalProfile,
  options: MatchOptions = {},
): MatchResult {
  const now = options.now ?? new Date();
  const d = scoreDirection(opp, profile);
  const m = scoreMentor(opp, profile);
  const r = scoreRequirements(opp, profile, now);
  const dims = [d.score, m.score, r.score];
  const total = round3(dims.reduce((s, x) => s + x.score * x.weight, 0));
  const gaps = [...d.gaps, ...m.gaps, ...r.gaps];
  const summary =
    `综合匹配度 ${total.toFixed(2)}（方向 ${d.score.score.toFixed(2)}×0.5 / ` +
    `导师 ${m.score.score.toFixed(2)}×0.3 / 条件 ${r.score.score.toFixed(2)}×0.2）；` +
    (gaps.length === 0 ? "无明显缺口" : `缺口 ${gaps.length} 项`);
  return {
    opportunityId: opp.id,
    score: total,
    dimensions: dims,
    gaps,
    summary,
    ruleVersion: MATCH_RULE_VERSION,
  };
}

// ── v0.1 已知局限 ──────────────────────────────────────────────
// 1. hit() 是子串匹配：短词（如 "AI"）可能误命中；长词更可靠。
//    与 PRD-061/T4 归类引擎的子串策略一致，保守起见未做分词。
// 2. 学位门槛是关键词启发式，不理解 "2:1 学位" 等英制表述。
// 3. 导师匹配只看名字重合，不评估研究方向契合度（那是方向维度的事）。
// 4. 缺失字段一律中性不扣分（宁可漏报，不错杀）；T5 可根据真实纠正率调严。
