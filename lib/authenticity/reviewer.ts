/**
 * 独立复核 agent 编排与交叉源规则（最小实现）—— PRD-176/T2（trend #881）。
 *
 * T1 规范：PRD-176/T1《真实性字段与三态（可信/待验证/可疑）规范》§2/§3/§四
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-176-opportunity-authenticity-t1.md）。
 * 本文件按 T1 落地，**不得擅自增删状态枚举、信号码与字段**。
 *
 * ── 上下文隔离（T1 §四，借鉴 cloudflare/security-audit-skill 的独立复核
 *    形态，MIT；本文件为自研表述，不拷贝其代码）─────────────────
 * 复核与采集是两个独立上下文：复核者的输入**只有证据原文**（快照 excerpt、
 * field_evidence、官方页 URL/摘录）与规则集；`ReviewerEvidence` 类型不含
 * 采集链路的推断字段（fit/why/action/summary 等），JS 侧多传也不读——
 * 结论独立给出，复核与采集不共享中间状态。
 *
 * ── 交叉源规则最小集（T1 §四 R1–R6）────────────────────────
 * 每条规则只输出 dim 级 state + evidence_refs（+ 信号）；全局 state 一律由
 * composeState() 按 T1 §3.2 合成，规则无权直接改全局。
 *
 * 纯函数、无副作用：不做任何网络请求；测试用 node --test（可擦除语法）。
 */

import { scanPostingText, type PostingGuardFlag } from "../local-apply/posting-guard.ts";
import {
  detectFeeDemand,
  detectSensitiveRequest,
  extractHost,
  isConfusableDomain,
  registrableDomain,
  signalsFromGuardFlags,
  S8_FAILURE_THRESHOLD,
  SIGNAL_DIM,
  isHardSignal,
  type AuthDim,
  type AuthSignal,
  type AuthSignalCode,
} from "./signals.ts";

// ── 三态与结论结构（T1 §2.2 / §3.2）─────────────────────────

/** 复核结论三态（T1 §3.2；unverified 只表示"从未复核"，不参与合成）。 */
export type AuthenticityState = "trusted" | "pending" | "suspicious";

/** dim 级结论（T1 §2.2 dims.*）。 */
export type AuthenticityDim = {
  state: AuthenticityState;
  reasons: string[];
  /** 指向云端 field_evidence.id（本地场景指向快照 excerpt 的引用名）。 */
  evidence_refs: string[];
};

/** 信号条目（T1 §2.2 signals）。 */
export type AuthenticitySignal = { code: AuthSignalCode; detail: string };

/** 复核者（T1 §2.2 reviewer；agent id 用自命名空间，虚构）。 */
export type AuthenticityReviewer = { kind: "agent" | "human"; id: string };

export const REVIEWER_ID = "auth-reviewer@v1";
export const AUTHENTICITY_JSON_VERSION = 1;

/** authenticity_json 结构（T1 §2.2，字段级一致）。 */
export type AuthenticityJson = {
  version: number;
  state: AuthenticityState;
  dims: Record<AuthDim, AuthenticityDim>;
  signals: AuthenticitySignal[];
  reviewer: AuthenticityReviewer;
  /** 0–100，复核自评置信度（确定性公式，见 confidenceOf）。 */
  confidence: number;
  /** 人工覆盖记录；T2 恒为 null（覆盖入口属 T3/T4 展示与联动）。 */
  override: { by: string; note: string; at: string } | null;
};

// ── 输入（隔离上下文：只含证据原文）─────────────────────────

export type FieldEvidenceRef = {
  fieldName: string;
  /** 证据原文摘录（复核者只看原文）。 */
  excerpt: string;
};

/**
 * 复核输入：证据原文集合。**刻意不包含** fit/why/action/summary 等
 * 采集链路推断字段（T1 §四隔离要求）。
 */
export type ReviewerEvidence = {
  opportunityId: string;
  title?: string;
  /** 机会上的机构名（公开情报）。 */
  org?: string;
  /** 机构官方域名（来自 institutions/sources 证据）。 */
  orgOfficialDomain?: string;
  /** 官方页上的机构名原文（证据摘录）。 */
  orgOfficialName?: string;
  /** 机会页 URL。 */
  officialPageUrl?: string;
  /** 官方页正文摘录（快照 excerpt 形态）。 */
  officialPageExcerpt?: string;
  /** 官方奖学金/资助说明页摘录（R4）。 */
  scholarshipPageExcerpt?: string;
  /** 机会提供的联系邮箱。 */
  contactEmail?: string;
  /** 资助/薪资声明原文。 */
  fundingClaim?: string;
  /** 从声明解析出的数额（同类口径，如月薪）。 */
  fundingAmount?: number;
  /** 同类机会分布中位数（统计输入，只读指标）。 */
  peerMedianAmount?: number;
  /** 机会正文快照 excerpt（S1/S2/S4 扫描对象）。 */
  bodyExcerpt?: string;
  /** 机会标注截止日。 */
  deadline?: string;
  /** 官方页/field_evidence 的截止日（R6）。 */
  officialDeadline?: string | null;
  /** 云端 field_evidence 引用（只读 excerpt）。 */
  fieldEvidence?: FieldEvidenceRef[];
  /** sources.consecutive_failures（采集链路只读指标，S8）。 */
  consecutiveFailures?: number;
  /** 快照缺失（S8）。 */
  snapshotMissing?: boolean;
};

// ── 规则产物 ─────────────────────────────────────────────────

type DimContribution = {
  dim: AuthDim;
  /** trusted 级理由（须附 evidence ref）。 */
  trustedReason?: string;
  /** pending 级理由（证据不足/待人工核对）。 */
  pendingReason?: string;
  evidenceRef?: string;
  signals?: AuthSignal[];
};

const DIM_IDS: readonly AuthDim[] = ["org", "salary_funding", "contact", "deadline"];

// ── 日期规范化（R6 截止日比对）──────────────────────────────

function parseDate(s: string): string | null {
  const m = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/.exec(s);
  if (m === null) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ── R1–R6 ────────────────────────────────────────────────────

/** R1 域名一致性（→ dims.org）。 */
function ruleDomainConsistency(ev: ReviewerEvidence): DimContribution | null {
  if (ev.officialPageUrl === undefined || ev.orgOfficialDomain === undefined) return null;
  const host = extractHost(ev.officialPageUrl);
  if (host.length === 0) return null;
  const hostReg = registrableDomain(host);
  const officialReg = registrableDomain(ev.orgOfficialDomain);
  if (hostReg === officialReg) {
    return {
      dim: "org",
      trustedReason: `机会页域名与机构官方域名一致（${hostReg}）`,
      evidenceRef: ev.officialPageUrl,
    };
  }
  if (isConfusableDomain(host, ev.orgOfficialDomain)) {
    return {
      dim: "org",
      signals: [{
        code: "S3",
        detail: `机会页域名 ${host} 与官方域名 ${ev.orgOfficialDomain} 同形异源（示例形态）`,
      }],
    };
  }
  return {
    dim: "org",
    pendingReason: `机会页域名（${hostReg}）与官方域名（${officialReg}）不一致，且无佐证`,
  };
}

/** R2 机构名一致性（→ dims.org）。 */
function ruleOrgNameConsistency(ev: ReviewerEvidence): DimContribution | null {
  if (ev.org === undefined || ev.org.length === 0) return null;
  // 同形异源拼写检查（复用 posting-guard 的 homoglyph 判定路径）。
  const guard = scanPostingText(ev.org);
  const orgHomoglyph = guard.flags.find((f) => f.kind === "homoglyph");
  if (orgHomoglyph !== undefined) {
    return {
      dim: "org",
      signals: [{ code: "S3", detail: `机构名同形异源拼写命中：${orgHomoglyph.detail}` }],
    };
  }
  const officialName = ev.orgOfficialName ?? ev.officialPageExcerpt;
  if (officialName === undefined) return null;
  if (officialName.includes(ev.org)) {
    return {
      dim: "org",
      trustedReason: "机构名与官方页原文一致",
      evidenceRef: "official_page_excerpt",
    };
  }
  return {
    dim: "org",
    pendingReason: "官方页原文未出现该机构名，须人工核对",
  };
}

/** R3 邮箱域名比对（→ dims.contact，S6）。 */
function ruleEmailDomain(ev: ReviewerEvidence): DimContribution | null {
  if (ev.contactEmail === undefined || !ev.contactEmail.includes("@")) return null;
  const emailHost = extractHost(ev.contactEmail);
  if (ev.orgOfficialDomain !== undefined) {
    if (registrableDomain(emailHost) === registrableDomain(ev.orgOfficialDomain)) {
      return {
        dim: "contact",
        trustedReason: `联系邮箱域名与机构官方域名一致（${registrableDomain(emailHost)}）`,
        evidenceRef: ev.contactEmail,
      };
    }
    // 官网佐证：官方页摘录里出现该邮箱/其域名，则不算失配。
    const excerpt = ev.officialPageExcerpt ?? "";
    if (excerpt.includes(ev.contactEmail) || excerpt.includes(emailHost)) {
      return {
        dim: "contact",
        trustedReason: "联系邮箱在官方页原文中有佐证",
        evidenceRef: "official_page_excerpt",
      };
    }
    return {
      dim: "contact",
      signals: [{
        code: "S6",
        detail: `联系邮箱域名（${registrableDomain(emailHost)}）与机构官方域名（${registrableDomain(ev.orgOfficialDomain)}）不一致，且官网无佐证`,
      }],
    };
  }
  return {
    dim: "contact",
    pendingReason: "缺少机构官方域名，邮箱域名无法比对，建议人工核对",
  };
}

/** R4 资助声明 vs 官方奖学金页（→ dims.salary_funding）。 */
function ruleFundingCorroboration(ev: ReviewerEvidence): DimContribution | null {
  if (ev.fundingClaim === undefined || ev.scholarshipPageExcerpt === undefined) return null;
  const numbers = ev.fundingClaim.match(/\d[\d,，.]*/g) ?? [];
  const keyNumber = numbers.find((n) => {
    const flat = n.replace(/[，,]/g, "");
    return flat.length >= 2 && Number(flat) > 0;
  });
  if (keyNumber !== undefined && ev.scholarshipPageExcerpt.includes(keyNumber.replace(/[，,]/g, ""))) {
    return {
      dim: "salary_funding",
      trustedReason: "资助声明数额在官方奖学金页原文中有佐证",
      evidenceRef: "scholarship_page_excerpt",
    };
  }
  if (/(奖学金|资助|津贴|薪资|工资| stipend|salary|funding)/i.test(ev.scholarshipPageExcerpt)) {
    return {
      dim: "salary_funding",
      pendingReason: "官方奖学金页提及资助但未逐字佐证声明数额，建议人工核对",
      evidenceRef: "scholarship_page_excerpt",
    };
  }
  return {
    dim: "salary_funding",
    pendingReason: "官方奖学金页未佐证资助声明，建议人工核对",
    evidenceRef: "scholarship_page_excerpt",
  };
}

/** R5 posting-guard 扫描（→ signals：S3/S4；云端对快照执行同型检测）。 */
function ruleGuardScan(ev: ReviewerEvidence): DimContribution | null {
  if (ev.bodyExcerpt === undefined || ev.bodyExcerpt.length === 0) return null;
  const result = scanPostingText(ev.bodyExcerpt);
  const signals = signalsFromGuardFlags(result.flags as PostingGuardFlag[]);
  if (signals.length === 0) return null;
  return { dim: "org", signals };
}

/** R6 截止日比对（→ dims.deadline，S7）。 */
function ruleDeadline(ev: ReviewerEvidence): DimContribution | null {
  if (ev.deadline === undefined || ev.officialDeadline === undefined || ev.officialDeadline === null) {
    return null;
  }
  const a = parseDate(ev.deadline);
  const b = parseDate(ev.officialDeadline);
  if (a === null || b === null) {
    return {
      dim: "deadline",
      pendingReason: "截止日无法解析比对（机会标注与官方原文格式缺失），建议人工核对",
      evidenceRef: "official_deadline",
    };
  }
  if (a === b) {
    return {
      dim: "deadline",
      trustedReason: `截止日与官方页/证据一致（${a}）`,
      evidenceRef: "official_deadline",
    };
  }
  return {
    dim: "deadline",
    signals: [{ code: "S7", detail: `截止日冲突：机会标注 ${a}，官方原文 ${b}` }],
  };
}

// ── S1/S2/S5/S8（信号判定；S3/S4/S6/S7 在规则内产出）────────

function signalsFromText(ev: ReviewerEvidence): AuthSignal[] {
  const text = [ev.bodyExcerpt ?? "", ev.officialPageExcerpt ?? ""].join("\n");
  const out: AuthSignal[] = [];
  const fee = detectFeeDemand(text);
  if (fee !== null) out.push({ code: "S1", detail: `正文出现收费要求形态：${fee}` });
  const sensitive = detectSensitiveRequest(text);
  if (sensitive !== null) out.push({ code: "S2", detail: `正文索要敏感证件/账户形态：${sensitive}` });
  return out;
}

function signalS5(ev: ReviewerEvidence, hasS1: boolean): AuthSignal | null {
  // T1 §3.1：薪资异常 = 显著偏离同类分布，且伴随 S1。
  if (!hasS1) return null;
  if (ev.fundingAmount === undefined || ev.peerMedianAmount === undefined) return null;
  if (ev.peerMedianAmount <= 0) return null;
  if (ev.fundingAmount >= ev.peerMedianAmount * 3) {
    return {
      code: "S5",
      detail: `资助/薪资数额（${ev.fundingAmount}）显著偏离同类机会分布（中位 ${ev.peerMedianAmount}），且伴随收费信号`,
    };
  }
  return null;
}

function signalsS8(ev: ReviewerEvidence): AuthSignal[] {
  const out: AuthSignal[] = [];
  if ((ev.consecutiveFailures ?? 0) >= S8_FAILURE_THRESHOLD) {
    out.push({ code: "S8", detail: `源连续失败 ${ev.consecutiveFailures} 次，超过阈值 ${S8_FAILURE_THRESHOLD}` });
  }
  if (ev.snapshotMissing === true) {
    out.push({ code: "S8", detail: "快照缺失，无法对机会页原文复核" });
  }
  return out;
}

// ── dim 合成（规则产物 → 四维）──────────────────────────────

type DimAccumulator = {
  signals: AuthSignal[];
  trustedReasons: string[];
  pendingReasons: string[];
  evidenceRefs: string[];
};

function synthesizeDim(acc: DimAccumulator): AuthenticityDim {
  const hard = acc.signals.filter((s) => isHardSignal(s.code));
  const soft = acc.signals.filter((s) => !isHardSignal(s.code));
  if (hard.length > 0) {
    return {
      state: "suspicious",
      reasons: [...acc.trustedReasons, ...acc.pendingReasons, ...acc.signals.map((s) => `${s.code}：${s.detail}`)],
      evidence_refs: [...acc.evidenceRefs],
    };
  }
  // T1 §3.2：同维两个及以上软信号命中 → suspicious（按信号条目计）。
  if (soft.length >= 2) {
    return {
      state: "suspicious",
      reasons: [...acc.trustedReasons, ...acc.pendingReasons, ...acc.signals.map((s) => `${s.code}：${s.detail}`)],
      evidence_refs: [...acc.evidenceRefs],
    };
  }
  if (soft.length === 1 || acc.pendingReasons.length > 0) {
    return {
      state: "pending",
      reasons: [...acc.pendingReasons, ...soft.map((s) => `${s.code}：${s.detail}`), ...acc.trustedReasons],
      evidence_refs: [...acc.evidenceRefs],
    };
  }
  // 无信号：有 trusted 理由 + 证据支撑 → trusted；否则证据不足 → pending。
  if (acc.trustedReasons.length > 0 && acc.evidenceRefs.length > 0) {
    return {
      state: "trusted",
      reasons: [...acc.trustedReasons],
      evidence_refs: [...acc.evidenceRefs],
    };
  }
  return {
    state: "pending",
    reasons: ["证据不足，未复核出可信结论（宁可待验证不误伤）"],
    evidence_refs: [...acc.evidenceRefs],
  };
}

// ── 置信度（确定性公式；T1 §3.2：阈值 T2 可调，T1 定形状）──

/**
 * 置信度（确定性公式，无时钟无随机）：基线 30；
 * +20 dims.org 有 evidence_refs；+20 dims.contact 有 evidence_refs；
 * +15 官方页摘录在场；+10 field_evidence 在场；上限 100。
 * trusted 门槛 80（T1 §3.2 给 80，T2 可调）。
 */
export const TRUSTED_CONFIDENCE_THRESHOLD = 80;

export function confidenceOf(input: {
  dims: Record<AuthDim, AuthenticityDim>;
  officialPageExcerpt?: string;
  fieldEvidenceCount: number;
}): number {
  let score = 30;
  if (input.dims.org.evidence_refs.length > 0) score += 20;
  if (input.dims.contact.evidence_refs.length > 0) score += 20;
  if (input.officialPageExcerpt !== undefined && input.officialPageExcerpt.length > 0) score += 15;
  if (input.fieldEvidenceCount > 0) score += 10;
  return Math.min(100, score);
}

// ── 全局合成（T1 §3.2；优先级 suspicious > pending > trusted）─

function composeState(
  dims: Record<AuthDim, AuthenticityDim>,
  signals: AuthenticitySignal[],
  confidence: number,
): AuthenticityState {
  if (signals.some((s) => isHardSignal(s.code))) return "suspicious";
  // 同维两个及以上软信号（按信号条目计）。
  const softByDim = new Map<AuthDim, number>();
  for (const s of signals) {
    if (isHardSignal(s.code)) continue;
    softByDim.set(SIGNAL_DIM[s.code], (softByDim.get(SIGNAL_DIM[s.code]) ?? 0) + 1);
  }
  for (const count of softByDim.values()) {
    if (count >= 2) return "suspicious";
  }
  // trusted：四维均达 trusted（无信号且证据充分），且 org/contact 各有
  // evidence_refs 支撑，confidence ≥ 阈值。
  const allTrusted = DIM_IDS.every((d) => dims[d].state === "trusted");
  const orgBacked = dims.org.evidence_refs.length >= 1;
  const contactBacked = dims.contact.evidence_refs.length >= 1;
  if (allTrusted && orgBacked && contactBacked && confidence >= TRUSTED_CONFIDENCE_THRESHOLD) {
    return "trusted";
  }
  return "pending";
}

// ── 编排入口 ─────────────────────────────────────────────────

/**
 * 独立复核：输入只有证据原文，输出 authenticity_json（T1 §2.2 全结构）。
 * 同一输入恒得同一结论（纯函数、确定性、无网络、无时钟）。
 */
export function reviewAuthenticity(ev: ReviewerEvidence): AuthenticityJson {
  const contributions = [
    ruleDomainConsistency(ev),   // R1
    ruleOrgNameConsistency(ev),  // R2
    ruleEmailDomain(ev),         // R3
    ruleFundingCorroboration(ev),// R4
    ruleGuardScan(ev),           // R5
    ruleDeadline(ev),            // R6
  ].filter((c): c is DimContribution => c !== null);

  const signals: AuthSignal[] = [...signalsFromText(ev), ...signalsS8(ev)];
  for (const c of contributions) {
    for (const s of c.signals ?? []) signals.push(s);
  }
  // S5 需要 S1 已命中（T1 §3.1）。
  const s5 = signalS5(ev, signals.some((s) => s.code === "S1"));
  if (s5 !== null) signals.push(s5);

  const acc: Record<AuthDim, DimAccumulator> = {
    org: { signals: [], trustedReasons: [], pendingReasons: [], evidenceRefs: [] },
    salary_funding: { signals: [], trustedReasons: [], pendingReasons: [], evidenceRefs: [] },
    contact: { signals: [], trustedReasons: [], pendingReasons: [], evidenceRefs: [] },
    deadline: { signals: [], trustedReasons: [], pendingReasons: [], evidenceRefs: [] },
  };
  for (const s of signals) acc[SIGNAL_DIM[s.code]].signals.push(s);
  for (const c of contributions) {
    const a = acc[c.dim];
    if (c.trustedReason !== undefined) a.trustedReasons.push(c.trustedReason);
    if (c.pendingReason !== undefined) a.pendingReasons.push(c.pendingReason);
    if (c.evidenceRef !== undefined) a.evidenceRefs.push(c.evidenceRef);
  }

  const dims = {
    org: synthesizeDim(acc.org),
    salary_funding: synthesizeDim(acc.salary_funding),
    contact: synthesizeDim(acc.contact),
    deadline: synthesizeDim(acc.deadline),
  };

  const confidence = confidenceOf({
    dims,
    officialPageExcerpt: ev.officialPageExcerpt,
    fieldEvidenceCount: ev.fieldEvidence?.length ?? 0,
  });

  const state = composeState(dims, signals, confidence);

  return {
    version: AUTHENTICITY_JSON_VERSION,
    state,
    dims,
    signals: signals.map((s) => ({ code: s.code, detail: s.detail })),
    reviewer: { kind: "agent", id: REVIEWER_ID },
    confidence,
    override: null,
  };
}
