/**
 * brain27 CLI —— PRD-080 生产落地-1：把 T2/T3/T4 串成命令行。
 *
 * 数据主权红线（T1 设计 §二/§五）：
 * - 本模块永不发起网络请求（无 fetch / WebSocket / 子进程联网）；
 * - 个人档案、草稿、评估结果只读本地文件、只写本地文件，绝不上云；
 * - v0.1 的 `pull` 从本地 JSON 文件读机会情报（真实 MCP/摘要 API 接线是后续事项，
 *   见 ISSUE_FOLLOWUP_MCP_WIRING）。
 * - 面试为非交互版（只出题）；交互式模拟是后续事项。
 * - 草稿存储为 SQLite 落盘（~/.brain27/brain27.db，PRD-097/T3 接线 sqlite-store.ts，接口与内存版一致）。
 */

import {
  matchOpportunity,
  type MatchOpportunity,
  type LocalProfile as MatcherProfile,
  type MatchResult,
} from "./matcher.ts";
import {
  draftCv,
  draftPs,
  draftEmail,
  type DraftKind,
  type DraftStore,
  type Draft,
  type OpportunityInput as DrafterOpportunity,
  type UserProfile as DrafterProfile,
  type GapAnalysis,
  type GapItem as DrafterGapItem,
  type GapDimension as DrafterGapDimension,
} from "./drafter.ts";
import {
  generateQuestions,
  INTERVIEW_CATEGORY_LABELS,
  type LocalOpportunity as InterviewOpportunity,
  type LocalProfile as InterviewProfile,
  type GapItem as InterviewGapItem,
  type GapDimension as InterviewGapDimension,
  type InterviewQuestion,
} from "./interview.ts";
import { authenticityDisplay } from "../authenticity/display.ts";

// ── CLI 档案：T2 档案为正，另加 T3/T4 需要的可选字段 ──

/** CLI 统一档案（JSON 文件形状）。绝不上云。 */
export type CliProfile = MatcherProfile & {
  /** 姓名（可选；T3 套磁信/PS 用，无则用占位符）。 */
  name?: string;
  /** 研究/项目经历，每条一句话（T3/T4 用）。 */
  experience?: string[];
};

/** 本地机会缓存（pull 产物）。 */
export type OpportunityCache = MatchOpportunity[];

// ── 适配器：三模块并行开发，类型各自为政，CLI 做最小转换 ──
// （统一类型是后续事项；此处转换逻辑有损，已在注释写明。）

function toDrafterOpportunity(o: MatchOpportunity): DrafterOpportunity {
  return {
    id: o.id,
    title: o.title,
    org: o.org ?? "未知机构",
    type: o.type ?? "unknown",
    region: o.region,
    deadline: o.deadline ?? null,
    keywords: o.keywords,
    mentors: o.mentors,
    description: o.body,
  };
}

function toDrafterProfile(p: CliProfile): DrafterProfile {
  return {
    name: p.name,
    education: [p.degree],
    experience: p.experience ?? [],
    skills: p.skills,
    interests: p.researchInterests,
  };
}

function toInterviewOpportunity(o: MatchOpportunity): InterviewOpportunity {
  return {
    id: o.id,
    title: o.title,
    org: o.org ?? "未知机构",
    type: o.type,
    region: o.region,
    funding: o.funding,
    deadline: o.deadline ?? null,
    keywords: o.keywords,
    mentor: o.mentors,
    description: o.body,
  };
}

function toInterviewProfile(p: CliProfile): InterviewProfile {
  return {
    education: [p.degree],
    researchInterests: p.researchInterests,
    skills: p.skills,
    experience: p.experience ?? [],
  };
}

/**
 * T2 的缺口是字符串（带维度前缀），T3/T4 要结构化 GapItem。
 * 按前缀推断维度；推断失败兜底为方向维度（v0.1 有损，文档已注明）。
 */
function adaptGaps(
  gaps: string[],
): { drafter: DrafterGapItem[]; interview: InterviewGapItem[] } {
  const drafter: DrafterGapItem[] = [];
  const interview: InterviewGapItem[] = [];
  for (const g of gaps) {
    let dDim: DrafterGapDimension = "direction";
    let iDim: InterviewGapDimension = "research_direction";
    if (g.startsWith("导师缺口")) {
      dDim = "mentor";
      iDim = "mentor";
    } else if (
      g.startsWith("类型不匹配") ||
      g.startsWith("地区不匹配") ||
      g.startsWith("资助不满足") ||
      g.startsWith("已过截止日") ||
      g.startsWith("学历门槛")
    ) {
      dDim = "eligibility";
      iDim = "requirements";
    }
    const severity = g.startsWith("已过截止日") || g.startsWith("学历门槛") ? "high" : "medium";
    drafter.push({ dimension: dDim, severity, detail: g });
    interview.push({ dimension: iDim, severity, description: g });
  }
  return { drafter, interview };
}

function toGapAnalysis(result: MatchResult): GapAnalysis {
  return {
    opportunityId: result.opportunityId,
    score: result.score,
    gaps: adaptGaps(result.gaps).drafter,
  };
}

// ── pull：校验 + 过滤 ──

const PULL_WHITELIST = [
  "id",
  "title",
  "org",
  "type",
  "region",
  "funding",
  "deadline",
  "body",
  "keywords",
  "mentors",
  "requirements",
  "authenticity",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out;
}

/** 校验单条机会：只要 id/title 为字符串即收录，其余按白名单字段取值。 */
function sanitizeOpportunity(raw: unknown): MatchOpportunity | null {
  if (!isRecord(raw)) return null;
  const id = raw["id"];
  const title = raw["title"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof title !== "string" || title.length === 0) return null;
  const opp: MatchOpportunity = { id, title };
  const get = (k: string): unknown => raw[k];
  if (typeof get("org") === "string") opp.org = get("org") as string;
  if (typeof get("type") === "string") opp.type = get("type") as MatchOpportunity["type"];
  if (typeof get("region") === "string") opp.region = get("region") as MatchOpportunity["region"];
  if (typeof get("funding") === "string") opp.funding = get("funding") as MatchOpportunity["funding"];
  if (typeof get("deadline") === "string" || get("deadline") === null)
    opp.deadline = get("deadline") as string | null;
  if (typeof get("body") === "string") opp.body = get("body") as string;
  const keywords = toStringArray(get("keywords"));
  if (keywords) opp.keywords = keywords;
  const mentors = toStringArray(get("mentors"));
  if (mentors) opp.mentors = mentors;
  const requirements = toStringArray(get("requirements"));
  if (requirements) opp.requirements = requirements;
  // PRD-176/T2（T1 §2.3）：authenticity 只读继承，内部只做 state/checkedAt
  // 字符串校验；缺字段 = unverified（老 cache.json 零迁移）。
  const authenticityRaw = get("authenticity");
  if (isRecord(authenticityRaw) && typeof authenticityRaw["state"] === "string" &&
      ["trusted", "pending", "suspicious"].includes(authenticityRaw["state"])) {
    const authenticity: NonNullable<MatchOpportunity["authenticity"]> = {
      state: authenticityRaw["state"] as NonNullable<MatchOpportunity["authenticity"]>["state"],
    };
    if (typeof authenticityRaw["checkedAt"] === "string") {
      authenticity.checkedAt = authenticityRaw["checkedAt"];
    }
    if (Array.isArray(authenticityRaw["signals"])) {
      const signals = authenticityRaw["signals"].filter(
        (s: unknown): s is { code: string; detail: string } =>
          isRecord(s) && typeof s["code"] === "string" && typeof s["detail"] === "string",
      );
      if (signals.length > 0) authenticity.signals = signals;
    }
    opp.authenticity = authenticity;
  }
  return opp;
}

export type PullOptions = {
  /** 按机会类型过滤（字符串精确匹配，如 "ra"）。 */
  type?: string;
  /** 按地区过滤（字符串精确匹配，如 "英国"）。 */
  region?: string;
};

export type PullResult = {
  cached: OpportunityCache;
  total: number;
  kept: number;
  dropped: number;
};

/**
 * pull：从本地 JSON（数组）读入机会，做白名单校验 + 可选过滤。
 * v0.1 不做网络拉取；真实 MCP/摘要 API 接线是后续事项。
 */
export function cmdPull(raw: unknown, opts: PullOptions = {}): PullResult {
  const arr = Array.isArray(raw) ? raw : [];
  const total = arr.length;
  let dropped = 0;
  const kept: MatchOpportunity[] = [];
  for (const item of arr) {
    const opp = sanitizeOpportunity(item);
    if (!opp) {
      dropped += 1;
      continue;
    }
    if (opts.type !== undefined && opp.type !== opts.type) {
      dropped += 1;
      continue;
    }
    if (opts.region !== undefined && opp.region !== opts.region) {
      dropped += 1;
      continue;
    }
    kept.push(opp);
  }
  return { cached: kept, total, kept: kept.length, dropped };
}

// ── match：T2 ──

function findOpportunity(cache: OpportunityCache, id: string): MatchOpportunity {
  const opp = cache.find((o) => o.id === id);
  if (!opp) throw new Error(`机会不存在：${id}（先用 brain27 pull 拉取/载入机会）`);
  return opp;
}

export type MatchCommandResult = {
  result: MatchResult;
  text: string;
};

export function cmdMatch(
  cache: OpportunityCache,
  profile: CliProfile,
  opportunityId: string,
  now: Date = new Date(),
): MatchCommandResult {
  const opp = findOpportunity(cache, opportunityId);
  const result = matchOpportunity(opp, profile, { now });
  const lines: string[] = [];
  lines.push(`匹配度 ${result.score.toFixed(2)}（${opp.title} / ${opp.org ?? "未知机构"}）`);
  for (const d of result.dimensions) {
    const label =
      d.dimension === "direction" ? "方向" : d.dimension === "mentor" ? "导师" : "条件";
    lines.push(`  ${label} ${d.score.toFixed(2)}×${d.weight}：${d.reasons.join("；")}`);
  }
  if (result.gaps.length > 0) {
    lines.push(`缺口 ${result.gaps.length} 项：`);
    for (const g of result.gaps) lines.push(`  - ${g}`);
  } else {
    lines.push("无明显缺口");
  }
  lines.push(result.summary);
  lines.push(guardText(result));
  lines.push(authenticityText(opp, result));
  return { result, text: lines.join("\n") };
}

/** 门禁是审查信号，不构成来源访问许可或申请授权。 */
function guardText(result: MatchResult): string {
  const flags = result.guardFlags ?? [];
  if (flags.length === 0) return "内容检查：未检出已知风险（不代表安全或接入许可）；申请/提交须人工核验，CLI 不提供投递。";
  // 只展示类别，不把第三方载荷原样写到终端（可能包含控制字符）。
  return `内容检查：待人工确认，命中 ${flags.length} 项：${[...new Set(flags.map(f => f.kind))].join("、")}。禁止生成草稿、申请或提交；请人工核对来源正文与网站限制，不得绕过访问限制。`;
}

// ── 真实性展示（PRD-176/T3，trend #882；T1 §2.3/§3.3/§5.2）──

/**
 * 「真实性」行（match 输出行尾追加，T1 §5.2）。展示口径取自
 * lib/authenticity/display.ts（T1 §3.3 单一来源）：
 * 缺字段 = unverified（灰色「未复核」）；本地不产生终审 state，以云端为准。
 */
export function authenticityText(opp: MatchOpportunity, result?: MatchResult): string {
  const display = authenticityDisplay(opp.authenticity?.state);
  const checkedAt = opp.authenticity?.checkedAt ? `（复核于 ${opp.authenticity.checkedAt}）` : "";
  const base = `真实性：${display.label}${checkedAt}${display.hint ? `——${display.hint}` : ""}`;
  // 本地 signals 与云端 state 冲突时按更严者呈现警示（T1 §2.3）：
  // 云端说「可信」而本地 posting-guard 命中 → 提示按更严口径人工核对。
  const localHits = result?.guardFlags?.length ?? 0;
  if (opp.authenticity?.state === "trusted" && localHits > 0) {
    return `${base}；注意：本地内容检查命中 ${localHits} 项，与云端「可信」结论不一致——按更严者呈现，请人工核对后再使用`;
  }
  return base;
}

// ── draft：T3 ──

export type DraftCommandResult = {
  draft: Draft;
  text: string;
};

const DRAFT_FNS: Record<DraftKind, (opp: DrafterOpportunity, profile: DrafterProfile, analysis?: GapAnalysis) => string> = {
  cv: draftCv,
  ps: draftPs,
  email: (opp, profile) => draftEmail(opp, profile),
};

export function cmdDraft(
  cache: OpportunityCache,
  profile: CliProfile,
  store: DraftStore,
  kind: DraftKind,
  opportunityId: string,
  now: Date = new Date(),
): DraftCommandResult {
  const opp = findOpportunity(cache, opportunityId);
  // 先跑 T2 拿缺口，再喂给 T3（链式调用）。
  const matchResult = matchOpportunity(opp, profile, { now });
  if (matchResult.guardFlags?.length) throw new Error(guardText(matchResult));
  const analysis = toGapAnalysis(matchResult);
  const content = DRAFT_FNS[kind](
    toDrafterOpportunity(opp),
    toDrafterProfile(profile),
    analysis,
  );
  const draft = store.save(kind, opportunityId, content);
  const kindLabel = kind === "cv" ? "简历建议" : kind === "ps" ? "个人陈述" : "套磁信";
  const lines = [
    `已保存草稿 ${draft.id}（${kindLabel}，版本 v${draft.version}，匹配度 ${matchResult.score.toFixed(2)}）`,
    guardText(matchResult),
    "---",
    content,
  ];
  return { draft, text: lines.join("\n") };
}

// ── interview：T4（v0.1 非交互，只出题） ──

export type InterviewCommandResult = {
  questions: InterviewQuestion[];
  text: string;
};

export function cmdInterview(
  cache: OpportunityCache,
  profile: CliProfile,
  opportunityId: string,
  now: Date = new Date(),
): InterviewCommandResult {
  const opp = findOpportunity(cache, opportunityId);
  // 先跑 T2 拿缺口，再喂给 T4（链式调用）。
  const matchResult = matchOpportunity(opp, profile, { now });
  const gaps = adaptGaps(matchResult.gaps).interview;
  const questions = generateQuestions(
    toInterviewOpportunity(opp),
    toInterviewProfile(profile),
    gaps,
  );
  const lines: string[] = [];
  lines.push(
    `面试准备：${opp.title} / ${opp.org ?? "未知机构"}（${questions.length} 题，非交互版；交互式模拟是后续事项）`,
  );
  lines.push(guardText(matchResult));
  let n = 0;
  for (const q of questions) {
    n += 1;
    const label = INTERVIEW_CATEGORY_LABELS[q.category] ?? q.category;
    lines.push(`[${label}] ${n}. ${q.question}`);
    lines.push(`    考察：${q.intent}；思路：${q.suggestedAngle}`);
  }
  return { questions, text: lines.join("\n") };
}

// ── status：本地盘点 ──

export type StatusResult = {
  text: string;
  counts: {
    opportunities: number;
    drafts: number;
    profile: string;
    /** 真实性分布（PRD-176/T3；缺字段计 unverified）。 */
    authenticity: { unverified: number; trusted: number; pending: number; suspicious: number };
  };
};

export function cmdStatus(
  cache: OpportunityCache,
  profile: CliProfile,
  store: DraftStore,
): StatusResult {
  const drafts = store.list();
  // 真实性分布（T1 §3.3 展示口径；缺字段 = unverified，老 cache.json 零迁移）。
  const authenticity = { unverified: 0, trusted: 0, pending: 0, suspicious: 0 };
  for (const opp of cache) {
    const state = opp.authenticity?.state ?? "unverified";
    if (state === "trusted" || state === "pending" || state === "suspicious") {
      authenticity[state] += 1;
    } else {
      authenticity.unverified += 1;
    }
  }
  const authLine =
    `- 真实性：已核验·可信 ${authenticity.trusted} · 待验证 ${authenticity.pending} · ` +
    `可疑 ${authenticity.suspicious} · 未复核 ${authenticity.unverified}`;
  const lines = [
    "brain27 本地状态（纯本地：本命令不发送任何数据）",
    `- 档案：${profile.degree}（兴趣：${profile.researchInterests.join("、") || "未填"}）`,
    `- 缓存机会：${cache.length} 条`,
    authLine,
    `- 草稿：${drafts.length} 份${drafts.length > 0 ? `（${drafts.map((d) => d.id).join("、")}）` : ""}`,
  ];
  if (authenticity.suspicious > 0) {
    const suspiciousIds = cache
      .filter((o) => o.authenticity?.state === "suspicious")
      .map((o) => o.id);
    lines.push(
      `  注意：${suspiciousIds.length} 条被标记「可疑」（${suspiciousIds.join("、")}）——展示仅作参考，投递前须人工复核`,
    );
  }
  return {
    text: lines.join("\n"),
    counts: {
      opportunities: cache.length,
      drafts: drafts.length,
      profile: profile.degree,
      authenticity,
    },
  };
}

// ── 参数解析与入口 ──

export const HELP_TEXT = `brain27 —— 本地申请助手（PRD-080）

纯本地保证：所有命令只读本地文件、只写本地文件，不向任何服务器发送数据。
个人档案、草稿、评估结果永不出机器。

用法：
  brain27 pull --input <opportunities.json> [--type <type>] [--region <region>] [--cache <path>]
      从本地 JSON 载入机会情报到本地缓存（v0.1；云端 MCP/摘要 API 接线是后续事项）
  brain27 match <opportunity-id> [--profile <path>] [--cache <path>]
      T2 匹配度评估 + 缺口分析
  brain27 draft <cv|ps|email> <opportunity-id> [--profile <path>] [--cache <path>]
      T3 草稿生成（本地存档、版本化；草稿带 AI 标注，需人工改写）
  brain27 interview <opportunity-id> [--profile <path>] [--cache <path>]
      T4 面试问题集（v0.1 非交互版；交互式模拟是后续事项）
  brain27 status [--profile <path>] [--cache <path>]
      本地数据盘点

命中内容检查风险时，草稿生成禁止，须人工核对来源；无自动申请或提交命令。

默认路径：--profile ~/.brain27/profile.json，--cache ~/.brain27/cache.json`;

export type ParsedArgs = {
  command: "pull" | "match" | "draft" | "interview" | "status" | "help";
  positional: string[];
  flags: Record<string, string | boolean>;
};

/** 极简参数解析：command + 位置参数 + --key value / --key=value。 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: ParsedArgs["command"] = "help";
  const rest = [...argv];
  if (rest.length > 0 && !rest[0].startsWith("-")) {
    const c = rest.shift() as string;
    if (c === "pull" || c === "match" || c === "draft" || c === "interview" || c === "status") {
      command = c;
    } else {
      return { command: "help", positional: [], flags: {} };
    }
  }
  let i = 0;
  while (i < rest.length) {
    const tok = rest[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq >= 0) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
        flags[tok.slice(2)] = rest[i + 1];
        i += 1;
      } else {
        flags[tok.slice(2)] = true;
      }
    } else {
      positional.push(tok);
    }
    i += 1;
  }
  return { command, positional, flags };
}

// ── 文件 IO（薄层；测试不碰真实 home） ──

export async function loadJsonFile(path: string): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path, "utf-8"));
}

export async function saveJsonFile(path: string, data: unknown): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/** 默认路径（仅 main 调用；测试传显式路径，不读真实 home）。 */
export async function defaultPaths(): Promise<{ profile: string; cache: string }> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(homedir(), ".brain27");
  return { profile: join(dir, "profile.json"), cache: join(dir, "cache.json") };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * CLI 入口（薄层）：参数解析 + 文件 IO + 命令分发 + 输出。
 * 返回进程退出码（0 成功，非 0 失败）。
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.command === "help") {
    console.log(HELP_TEXT);
    return 0;
  }
  const defaults = await defaultPaths();
  const profilePath = flagString(parsed.flags, "profile") ?? defaults.profile;
  const cachePath = flagString(parsed.flags, "cache") ?? defaults.cache;

  try {
    if (parsed.command === "pull") {
      const inputPath = flagString(parsed.flags, "input");
      if (!inputPath) throw new Error("pull 需要 --input <opportunities.json>");
      const raw = await loadJsonFile(inputPath);
      const result = cmdPull(raw, {
        type: flagString(parsed.flags, "type"),
        region: flagString(parsed.flags, "region"),
      });
      await saveJsonFile(cachePath, result.cached);
      console.log(
        `已缓存 ${result.kept} 条机会（共 ${result.total} 条，丢弃 ${result.dropped} 条）→ ${cachePath}`,
      );
      return 0;
    }

    const cacheRaw = await loadJsonFile(cachePath);
    const pullResult = cmdPull(cacheRaw);
    const cache = pullResult.cached;
    const profileRaw = await loadJsonFile(profilePath);
    const profile = profileRaw as CliProfile;
    if (typeof profile.degree !== "string" || !Array.isArray(profile.researchInterests)) {
      throw new Error(`档案文件格式不正确：${profilePath}（需要 degree/researchInterests）`);
    }
    if (parsed.command === "status") {
      const { createSqliteDraftStore } = await import("./sqlite-store.ts");
      const store = createSqliteDraftStore();
      try {
        console.log(cmdStatus(cache, profile, store).text);
        return 0;
      } finally { store.close(); }
    }
    const opportunityId = parsed.positional[0];
    if (!opportunityId) throw new Error(`缺少 <opportunity-id>，用法见 brain27 ${parsed.command} --help`);
    if (parsed.command === "match") {
      console.log(cmdMatch(cache, profile, opportunityId).text);
      return 0;
    }
    if (parsed.command === "interview") {
      console.log(cmdInterview(cache, profile, opportunityId).text);
      return 0;
    }
    if (parsed.command === "draft") {
      const kinds: DraftKind[] = ["cv", "ps", "email"];
      const kindFirst = kinds.includes(parsed.positional[0] as DraftKind);
      const kind = (kindFirst ? parsed.positional[0] : parsed.positional[1]) as DraftKind;
      const id = kindFirst ? parsed.positional[1] : parsed.positional[0];
      if (!kind || !kinds.includes(kind)) throw new Error("draft 用法：brain27 draft <cv|ps|email> <opportunity-id>");
      if (!id) throw new Error("draft 缺少 <opportunity-id>");
      // 检查先于 SQLite 初始化；命中时不生成或保存草稿。
      const review = matchOpportunity(findOpportunity(cache, id), profile);
      if (review.guardFlags?.length) throw new Error(guardText(review));
      const { createSqliteDraftStore } = await import("./sqlite-store.ts");
      const store = createSqliteDraftStore();
      try {
        console.log(cmdDraft(cache, profile, store, kind, id).text);
        return 0;
      } finally { store.close(); }
    }
    console.log(HELP_TEXT);
    return 0;
  } catch (err) {
    console.error(`brain27: ${(err as Error).message}`);
    return 1;
  }
}
