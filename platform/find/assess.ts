/**
 * 资格评估：每条要求只能是 满足 / 不满足 / 未知；满足 / 不满足 必须带档案依据，否则改为未知；
 * 只能引用该机会已校验的要求原文。每次最多 5 条机会一起送模型。
 */
import type { LlmProvider } from "../llm/types.ts";
import type { GoalTarget, ProfileData } from "../profile/schema.ts";

export type EligibilityStatus = "满足" | "不满足" | "未知";
export type EligibilityItem = { requirement: string; status: EligibilityStatus; evidence: string | null };
export type Assessment = { items: EligibilityItem[]; reasons: string[]; gaps: string[]; score: number };
export type AssessInput = { key: string; title: string; org: string | null; requirements: string[]; location: string | null; kind: string | null };

const BATCH = 5;
const STATUSES: EligibilityStatus[] = ["满足", "不满足", "未知"];

const SYSTEM = `你是求职与升学资格评估助手。根据 <profile> 中的档案和 <target> 中的目标，逐条判断每个机会的要求是否满足。

规则：
1. 每条要求只能判为 "满足"、"不满足" 或 "未知"。
2. 只依据档案中明确写出的事实判断；档案里没有相关信息就判 "未知"，不要推测。
3. 判为 "满足" 或 "不满足" 时，"evidence" 必须引用档案里的原话作为依据；判 "未知" 时 evidence 为 null。
4. "requirement" 必须原样使用给出的要求文字。
5. "reasons" 写最多 3 条匹配理由，"gaps" 写最多 3 条主要差距，都要引用档案中的具体事实；"score" 为 0–100 的整数，表示整体匹配程度。
6. 只输出一个合法的 json 对象：{"results": [{"key": 机会 key, "items": [{"requirement":…, "status":…, "evidence":…}], "reasons": [...], "gaps": [...], "score": 整数}]}`;

function short(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? [...trimmed].slice(0, max).join("") : null;
}

function shortList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => short(item)).filter((item): item is string => item !== null).slice(0, 5);
}

export function verifyAssessment(raw: unknown, requirements: string[]): Assessment {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const byRequirement = new Map<string, EligibilityItem>();
  for (const item of Array.isArray(root.items) ? root.items : []) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const requirement = typeof r.requirement === "string" ? r.requirement.trim() : "";
    if (!requirements.includes(requirement) || byRequirement.has(requirement)) continue;
    let status: EligibilityStatus = STATUSES.includes(r.status as EligibilityStatus) ? (r.status as EligibilityStatus) : "未知";
    let evidence = short(r.evidence, 300);
    if (status !== "未知" && !evidence) status = "未知";
    if (status === "未知") evidence = null;
    byRequirement.set(requirement, { requirement, status, evidence });
  }
  const score = typeof root.score === "number" && Number.isFinite(root.score) ? Math.min(100, Math.max(0, Math.round(root.score))) : 0;
  return {
    items: requirements.map((requirement) => byRequirement.get(requirement) ?? { requirement, status: "未知", evidence: null }),
    reasons: shortList(root.reasons),
    gaps: shortList(root.gaps),
    score,
  };
}

function profileMaterial(profile: ProfileData): string {
  // 不含姓名：评估不需要身份信息。
  return JSON.stringify({
    location: profile.basics.location,
    education: profile.education,
    experience: profile.experience,
    skills: profile.skills,
    outputs: profile.outputs,
  });
}

export async function assessOpportunities(llm: LlmProvider, profile: ProfileData, target: GoalTarget, opps: AssessInput[]): Promise<Map<string, Assessment>> {
  const results = new Map<string, Assessment>();
  for (let start = 0; start < opps.length; start += BATCH) {
    const batch = opps.slice(start, start + BATCH);
    const user = `<profile>\n${profileMaterial(profile)}\n</profile>\n<target>\n${JSON.stringify(target)}\n</target>\n机会：\n${batch
      .map((opp) => JSON.stringify({ key: opp.key, title: opp.title, org: opp.org, location: opp.location, kind: opp.kind, requirements: opp.requirements }))
      .join("\n")}`;
    const { json } = await llm.completeJson([
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ]);
    const list = json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results) ? (json as { results: unknown[] }).results : [];
    const byKey = new Map<string, unknown>();
    for (const item of list) {
      if (item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string") byKey.set((item as { key: string }).key, item);
    }
    for (const opp of batch) results.set(opp.key, verifyAssessment(byKey.get(opp.key), opp.requirements));
  }
  return results;
}
