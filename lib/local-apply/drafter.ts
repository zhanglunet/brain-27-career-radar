/**
* PRD-080/T3 申请材料定制（本地）
* ============================================================
* v0.1 = 模板 + 规则版草稿生成（slot filling + 缺口驱动强调）。
* LLM 润色明确不在本期范围，见底部的 LlmPolisher 钩子类型。
*
* 数据主权红线（T1 §二，代码层执行）：
* 1. 本模块不发起任何网络请求（无 fetch / 无 HTTP import）。
* 2. 本模块不记录任何日志（无 console.*），个人内容不可能经由本模块外泄。
* 3. 本模块没有任何发送能力——没有 send/mail/deliver/submit 函数，
* 这是按 PRD-080 非目标（"不做自动投递"）有意为之，不是遗漏。
* 对外发送（投递/套磁）永远走人工，CLI 不提供发送命令。
*/

export type DraftKind = "cv" | "ps" | "email";

/** 机会输入：取自 T1 §4.2 白名单字段的子集（全部公开情报）。 */
export type OpportunityInput = {
id: string;
title: string;
org: string;
type: string;
region?: string;
deadline?: string | null;
/** facets.keywords */
keywords?: string[];
/** 导师名（PRD-061 关联 / detail 下钻），可为空 */
mentors?: string[];
description?: string;
};

/** 用户背景档案：本地 ~/.brain27/ profile 表的形状（JSON 单行）。绝不上云。 */
export type UserProfile = {
name?: string;
education: string[];
/** 研究/项目经历，每条一句话 */
experience: string[];
skills: string[];
interests: string[];
};

export type GapDimension = "direction" | "mentor" | "eligibility";
export type GapSeverity = "high" | "medium" | "low";

export type GapItem = {
dimension: GapDimension;
severity: GapSeverity;
detail: string;
};

/**
* T2 匹配评估输出的最小本地形状。
* 注意：T2 与 T3 并行开发，此处不 import T2 的代码，只约定形状。
*/
export type GapAnalysis = {
opportunityId: string;
/** 0..1，仅作参考信息写入草稿备注，不参与任何决策 */
score: number;
gaps: GapItem[];
};

/** 强制标注：每份草稿都必须携带，代码层强制（见 withMarker）。 */
export const AI_DRAFT_MARKER = "AI 草稿，需人工改写";

export type Draft = {
/** `${kind}:${opportunityId}:v${version}` */
id: string;
kind: DraftKind;
opportunityId: string;
version: number;
createdAt: string;
/** 恒等于 AI_DRAFT_MARKER */
marker: typeof AI_DRAFT_MARKER;
/** Markdown 正文（首部已带标注块） */
content: string;
};

const MARKER_BLOCK =
`> ⚠️ ${AI_DRAFT_MARKER}\n` +
`> 本稿由本地规则引擎生成（模板 + 规则，v0.1），未经人工审阅不得直接发送。`;

const PLACEHOLDER = (slot: string): string => `[待填写：${slot}]`;

function norm(s: string): string {
return s.toLowerCase().replace(/\s+/g, "");
}

/**
* 关键词是否命中一段文本。短词（<2 字符）跳过，避免 "AI" 误命中 "said" 之类。
* 纯 ASCII 关键词要求按词边界命中（防 "AI" 命中 "air"）。
*/
function keywordHits(text: string, keyword: string): boolean {
const k = norm(keyword);
if (k.length < 2) return false;
const t = norm(text);
if (/^[a-z0-9]+$/.test(k)) {
return new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(t);
}
return t.includes(k);
}

function profileCorpus(profile: UserProfile): string[] {
return [...profile.education,...profile.experience,...profile.skills,...profile.interests];
}

function matchedKeywords(opp: OpportunityInput, profile: UserProfile): string[] {
const corpus = profileCorpus(profile);
return (opp.keywords?? []).filter((kw) => corpus.some((line) => keywordHits(line, kw)));
}

function unmatchedKeywords(opp: OpportunityInput, profile: UserProfile): string[] {
const matched = new Set(matchedKeywords(opp, profile));
return (opp.keywords?? []).filter((kw) =>!matched.has(kw));
}

/** 命中关键词的档案条目（用于"建议强调"）。 */
function supportingLines(opp: OpportunityInput, profile: UserProfile): string[] {
const kws = matchedKeywords(opp, profile);
if (kws.length === 0) return [];
return profileCorpus(profile).filter((line) => kws.some((kw) => keywordHits(line, kw)));
}

function withMarker(body: string): string {
return `${MARKER_BLOCK}\n\n${body}`;
}

function gapsBySeverity(gaps: GapItem[] | undefined, severity: GapSeverity): GapItem[] {
return (gaps?? []).filter((g) => g.severity === severity);
}

const DIMENSION_LABEL: Record<GapDimension, string> = {
direction: "研究方向",
mentor: "导师匹配",
eligibility: "申请条件",
};

/**
* draftCv：简历"调整建议"（结构化建议，不是改写后的简历文件）。
* 只给建议、不断言——最终取舍由用户做。
*/
export function draftCv(
opp: OpportunityInput,
profile: UserProfile,
analysis?: GapAnalysis,
): string {
const matched = matchedKeywords(opp, profile);
const unmatched = unmatchedKeywords(opp, profile);
const support = supportingLines(opp, profile);
const highGaps = gapsBySeverity(analysis?.gaps, "high");

const lines: string[] = [];
lines.push(`# 简历调整建议（针对：${opp.title} / ${opp.org}）`, "");
lines.push(`## 关键词覆盖`);
lines.push(`- 已覆盖（${matched.length}）：${matched.length > 0? matched.join("、"): "无"}`);
lines.push(`- 未覆盖（${unmatched.length}）：${unmatched.length > 0? unmatched.join("、"): "无"}`);
lines.push("");
lines.push(`## 建议强调`);
if (support.length > 0) {
for (const s of support.slice(0, 6)) lines.push(`- ${s}`);
} else {
lines.push(`- ${PLACEHOLDER("与机会关键词相关的经历，简历中暂无对应条目")}`);
}
lines.push("");
lines.push(`## 建议补充（缺口驱动）`);
if (highGaps.length > 0) {
for (const g of highGaps) {
lines.push(`- 【${DIMENSION_LABEL[g.dimension]}·高缺口】${g.detail}`);
}
} else {
lines.push(`- 本次评估未发现高缺口；中低缺口可在 PS 中顺带回应。`);
}
lines.push("");
lines.push(`## 备注`);
if (analysis) lines.push(`- T2 匹配度参考分：${analysis.score.toFixed(2)}（仅参考，不作决策依据）`);
lines.push(`- 以上均为建议条目，请人工取舍后自行改写简历正文。`);
return withMarker(lines.join("\n"));
}

/**
* draftPs：PS / 研究计划初稿（模板填充）。
* 缺失信息一律用 [待填写] 占位，绝不编造事实。
*/
export function draftPs(
opp: OpportunityInput,
profile: UserProfile,
analysis?: GapAnalysis,
): string {
const name = profile.name?? PLACEHOLDER("姓名");
const edu = profile.education.length > 0? profile.education.join("；"): PLACEHOLDER("教育背景");
const kws = opp.keywords?? [];
const kwText = kws.length > 0? kws.slice(0, 5).join("、"): PLACEHOLDER("研究方向关键词");
const support = supportingLines(opp, profile);
const relevantExp =
support.length > 0? support.slice(0, 3): [PLACEHOLDER("与申请方向相关的研究经历")];
const highGaps = gapsBySeverity(analysis?.gaps, "high");
const deadline = opp.deadline?? "待确认";

const lines: string[] = [];
lines.push(`# 个人陈述（初稿）：${opp.title}`, "");
lines.push(`我叫${name}，${edu}。`);
lines.push(
`我申请${opp.org}的${opp.type}项目（${opp.title}），` +
`研究兴趣集中在${kwText}方向。`,
);
lines.push("");
lines.push(`## 学术背景`);
for (const e of relevantExp) lines.push(`- ${e}`);
lines.push("");
lines.push(`## 与项目的契合`);
lines.push(
`${opp.org}在${kwText}方向的积累与我的研究经历高度相关` +
`${opp.region? `（${opp.region}）`: ""}。` +
`我希望在博士阶段继续深入该方向。`,
);
lines.push("");
lines.push(`## 待人工补充`);
if (highGaps.length > 0) {
for (const g of highGaps) {
lines.push(`- ${g.detail}——请在终稿中正面回应或补足。`);
}
} else {
lines.push(`- ${PLACEHOLDER("针对该项目的个性化动机（一两句真话，比模板更重要）")}`);
}
lines.push("");
lines.push(`## 备注`);
lines.push(`- 截止日期：${deadline}`);
if (analysis) lines.push(`- T2 匹配度参考分：${analysis.score.toFixed(2)}（仅参考）`);
return withMarker(lines.join("\n"));
}

/**
* draftEmail：套磁信（cold email）草稿。
* 联系方式一律留占位，由用户亲手填写——这是有意的，
* 避免草稿里带着真实联系方式被误发。
*/
export function draftEmail(opp: OpportunityInput, profile: UserProfile): string {
const name = profile.name?? PLACEHOLDER("姓名");
const mentor = (opp.mentors?? [])[0];
const greeting = mentor? `尊敬的${mentor}教授`: `尊敬的招生老师`;
const edu = profile.education.length > 0? profile.education[0]: PLACEHOLDER("教育背景");
const kws = opp.keywords?? [];
const kwText = kws.length > 0? kws.slice(0, 3).join("、"): PLACEHOLDER("研究方向");

const lines: string[] = [];
lines.push(`# 套磁信草稿：${opp.org}${mentor? ` / ${mentor}`: ""}`, "");
lines.push(`**主题**：申请意向咨询：${opp.title}（${name}）`, "");
lines.push(`${greeting}：`, "");
lines.push(
`您好！我叫${name}，${edu}。` +
`我关注到${opp.org}的${opp.title}，` +
`我的研究兴趣在${kwText}方向，与您的团队方向契合，` +
`想咨询该项目是否还在招生，以及您对申请者的建议。`,
);
lines.push("");
lines.push(`附件是我的简历，方便时请查阅。期待您的回复，占用您时间非常感谢！`, "");
lines.push(`---`, "");
lines.push(`${name}`, `[联系方式]`, `[个人主页/LinkedIn（如有）]`);
return withMarker(lines.join("\n"));
}

/**
* LLM 润色钩子（v0.1 未实现，留档）。
*
* 后续任务可在此接入本地 Ollama：输入某份草稿的 content，输出润色后文本。
* 约束（T1 §三）：
* - 必须走 localhost（Ollama），个人材料不出机器；
* - 输出仍须携带 AI_DRAFT_MARKER（调用方负责 withMarker 包裹）；
* - 云端 LLM 只有在用户逐次显式授权后才可作为备选，且走独立审计。
*/
export type LlmPolisher = (
text: string,
context: { kind: DraftKind; opportunityId: string},
) => Promise<string>;

/**
* 本地版本化草稿存储（v0.1 内存实现）。
*
* 生产目标是 T1 §4.3 的 SQLite（~/.brain27/brain27.db materials 表）；
* v0.1 用内存实现是为了让 T3 可独立测试，接口与 SQLite 版保持一致
* （save / list / get 语义不变，届时只换实现）。
*/
export type DraftStore = {
save(kind: DraftKind, opportunityId: string, content: string): Draft;
list(opportunityId?: string): Draft[];
get(kind: DraftKind, opportunityId: string, version?: number): Draft | undefined;
};

export function createDraftStore(now: () => Date = () => new Date()): DraftStore {
const drafts: Draft[] = [];
return {
save(kind, opportunityId, content) {
const version =
drafts.filter((d) => d.kind === kind && d.opportunityId === opportunityId).length + 1;
const draft: Draft = {
id: `${kind}:${opportunityId}:v${version}`,
kind,
opportunityId,
version,
createdAt: now().toISOString(),
marker: AI_DRAFT_MARKER,
content,
};
drafts.push(draft);
return draft;
},
list(opportunityId?: string) {
const rows =
opportunityId === undefined
? drafts
: drafts.filter((d) => d.opportunityId === opportunityId);
return [...rows];
},
get(kind, opportunityId, version?: number) {
const rows = drafts.filter((d) => d.kind === kind && d.opportunityId === opportunityId);
if (version === undefined) return rows[rows.length - 1];
return rows.find((d) => d.version === version);
},
};
}
