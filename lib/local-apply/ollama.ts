/**
 * PRD-080/生产落地-2 · Ollama 本地 LLM 接入（trend #435）。
 *
 * 把 T2 的 LlmRerankFn、T3 的 LlmPolisher 钩子接到本机 Ollama：
 * - checkAvailability()：Ollama 在不在、有哪些模型
 * - rerank：按 LlmRerankFn 形状，对规则打分做本地 LLM 第二意见
 * - polish：按 LlmPolisher 形状，润色草稿（标注强制保留）
 *
 * ── 数据主权红线 ─────────────────────────────────────────────
 * 1. 本模块只连接 loopback（127.0.0.1 / ::1 / localhost），默认
 *    http://127.0.0.1:11434，可经环境变量 OLLAMA_HOST 覆盖——但覆盖值
 *    也必须是 loopback，否则构造时直接抛错（assertLoopback）。
 * 2. 个人材料（简历/PS/档案/评估结果）永不离开本机：发往的唯一目标
 *    是本机 Ollama。
 * 3. 云端 LLM 默认关闭：本模块不实现任何云端客户端、不读任何 API Key、
 *    不构造任何非 loopback URL。Ollama 不可用时抛 OllamaUnavailable，
 *    调用方降级回纯规则版——绝不静默切到云端，也绝不重试云端。
 * ────────────────────────────────────────────────────────────
 *
 * 约定：只用可擦除 TypeScript 语法（无 enum / namespace），
 * `node --test` 可直接运行。
 */

import type {
  DimensionId,
  LlmRerankFn,
  MatchResult,
} from "./matcher.ts";
import { MATCH_WEIGHTS } from "./matcher.ts";
import { AI_DRAFT_MARKER } from "./drafter.ts";
import type { LlmPolisher } from "./drafter.ts";

/** 复导出 drafter 的标注（复用，不重定义）：调用方只需 import 本模块。 */
export { AI_DRAFT_MARKER };

/** 默认 Ollama 地址（本机）。 */
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
/** 默认模型（T1 §3.1 默认推荐：8B 级，T2 时实测选定）。 */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";
/** /api/generate 默认超时：本地 8B 生成慢，放宽到 2 分钟。 */
export const DEFAULT_GENERATE_TIMEOUT_MS = 120_000;
/** /api/tags 可用性检查超时。 */
export const AVAILABILITY_TIMEOUT_MS = 10_000;

/**
 * Ollama 不可用时抛出的类型化错误（连不上 / 超时 / 非 200）。
 * 调用方捕获后降级回纯规则版——错误信息里写明"未尝试任何云端"。
 */
export class OllamaUnavailable extends Error {
  cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(`Ollama 不可用：${message}（已降级回纯规则版，未尝试任何云端）`);
    this.name = "OllamaUnavailable";
    this.cause = cause;
  }
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/**
 * 断言 URL 是 loopback。非本机地址直接抛错——这是数据主权红线的
 * 代码层执行点：个人材料只能发往本机。
 */
export function assertLoopback(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OLLAMA_HOST 非法 URL：${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OLLAMA_HOST 协议不受支持：${raw}`);
  }
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `OLLAMA_HOST 必须是 loopback（localhost/127.0.0.1/::1），拒绝非本机地址：${raw}（数据主权红线）`,
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export type OllamaClientOptions = {
  /** 默认：环境变量 OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST（必须经 assertLoopback）。 */
  host?: string;
  /** 默认 DEFAULT_OLLAMA_MODEL。 */
  model?: string;
  /** /api/generate 超时毫秒数，默认 120_000。 */
  timeoutMs?: number;
  /** 测试注入；默认 globalThis.fetch。 */
  fetchFn?: typeof fetch;
};

export type OllamaClient = {
  readonly host: string;
  readonly model: string;
  /** Ollama 在不在、有哪些模型。连不上时返回 { available: false }，不抛错。 */
  checkAvailability(): Promise<{ available: boolean; models: string[] }>;
  /** 直调 /api/generate（stream: false）。失败时抛 OllamaUnavailable。 */
  generate(prompt: string, system?: string): Promise<string>;
  /** 按 LlmRerankFn 形状：本地 LLM 第二意见，解析失败则原样返回。 */
  rerank: LlmRerankFn;
  /** 按 LlmPolisher 形状：润色草稿，AI 标注强制保留。 */
  polish: LlmPolisher;
};

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const RERANK_SYSTEM =
  "你是博士申请评估助手，只输出 JSON，不要解释。";

function buildRerankPrompt(
  result: MatchResult,
  opportunityTitle: string,
  profileSummary: string,
): string {
  const dims = result.dimensions
    .map((d) => `- ${d.dimension}: ${d.score}（理由：${d.reasons.join("；")}）`)
    .join("\n");
  return [
    "以下是规则引擎对某个申请机会的匹配打分，请给出你的第二意见。",
    `机会：${opportunityTitle}`,
    `申请人摘要：${profileSummary}`,
    "规则打分：",
    dims,
    "缺口：",
    result.gaps.join("；") || "无",
    "请只输出一行 JSON：",
    `{"direction": 0~1, "mentor": 0~1, "requirements": 0~1, "note": "一句话理由"}`,
  ].join("\n");
}

type RerankAdjustment = {
  direction: number;
  mentor: number;
  requirements: number;
  note: string;
};

/** 从 LLM 输出里抠 JSON；抠不出或不合法就返回 null（调用方原样返回，不瞎改分）。 */
function parseRerankJson(raw: string): RerankAdjustment | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ids: DimensionId[] = ["direction", "mentor", "requirements"];
  for (const id of ids) {
    const v = obj[id];
    if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 1) return null;
  }
  return {
    direction: obj["direction"] as number,
    mentor: obj["mentor"] as number,
    requirements: obj["requirements"] as number,
    note: typeof obj["note"] === "string" ? (obj["note"] as string) : "",
  };
}

const POLISH_SYSTEM =
  "你是中文求职文书润色助手。只润色文字，不改变事实，不编造经历。";

function buildPolishPrompt(text: string, kind: string, opportunityId: string): string {
  return [
    `请润色以下${kind}草稿（针对机会 ${opportunityId}）：`,
    "要求：语言更自然专业；不改变事实；不编造没有的信息；保留原文结构。",
    "---",
    text,
  ].join("\n");
}

/** 强制保留 AI 标注：LLM 可能吞掉标注，代码层补回。 */
function ensureMarker(text: string): string {
  if (text.includes(AI_DRAFT_MARKER)) return text;
  return `> ⚠️ ${AI_DRAFT_MARKER}\n\n${text}`;
}

export function createOllamaClient(
  options: OllamaClientOptions = {},
): OllamaClient {
  const envHost =
    typeof process !== "undefined" && process.env
      ? process.env["OLLAMA_HOST"]
      : undefined;
  const host = assertLoopback(
    options.host ?? envHost ?? DEFAULT_OLLAMA_HOST,
  );
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  const fetchFn: typeof fetch =
    options.fetchFn ??
    (typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : (() => {
          throw new OllamaUnavailable("当前环境无 fetch 可用");
        }) as typeof fetch);

  async function checkAvailability(): Promise<{
    available: boolean;
    models: string[];
  }> {
    try {
      const res = await fetchWithTimeout(
        fetchFn,
        `${host}/api/tags`,
        {},
        AVAILABILITY_TIMEOUT_MS,
      );
      if (!res.ok) return { available: false, models: [] };
      const data = (await res.json()) as {
        models?: Array<{ name?: string }>;
      };
      const models = (data.models ?? [])
        .map((m) => m.name ?? "")
        .filter((n) => n.length > 0);
      return { available: true, models };
    } catch {
      return { available: false, models: [] };
    }
  }

  async function generate(prompt: string, system?: string): Promise<string> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        fetchFn,
        `${host}/api/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, system, stream: false }),
        },
        timeoutMs,
      );
    } catch (err) {
      throw new OllamaUnavailable(
        `连接失败（${host}），请确认 ollama serve 正在运行`,
        err,
      );
    }
    if (!res.ok) {
      throw new OllamaUnavailable(
        `HTTP ${res.status}（${host}/api/generate）`,
      );
    }
    let data: { response?: string };
    try {
      data = (await res.json()) as { response?: string };
    } catch (err) {
      throw new OllamaUnavailable("响应解析失败", err);
    }
    return data.response ?? "";
  }

  const rerank: LlmRerankFn = async (result, ctx) => {
    const profileSummary = [
      `学历：${ctx.profile.degree}`,
      `兴趣：${ctx.profile.researchInterests.join("、")}`,
      `技能：${ctx.profile.skills.join("、")}`,
    ].join("；");
    const raw = await generate(
      buildRerankPrompt(result, ctx.opportunity.title, profileSummary),
      RERANK_SYSTEM,
    );
    const adj = parseRerankJson(raw);
    if (!adj) return result; // 解析失败 → 原样返回，不瞎改分
    const dimensions = result.dimensions.map((d) => {
      const v = adj[d.dimension];
      const note = adj.note ? `LLM 复核：${adj.note}` : "LLM 复核";
      return { ...d, score: round3(v), reasons: [...d.reasons, note] };
    });
    const score = round3(
      dimensions.reduce((acc, d) => {
        const w =
          d.dimension === "direction"
            ? MATCH_WEIGHTS.direction
            : d.dimension === "mentor"
              ? MATCH_WEIGHTS.mentor
              : MATCH_WEIGHTS.requirements;
        return acc + d.score * w;
      }, 0),
    );
    return { ...result, score, dimensions };
  };

  const polish: LlmPolisher = async (text, context) => {
    const raw = await generate(
      buildPolishPrompt(text, context.kind, context.opportunityId),
      POLISH_SYSTEM,
    );
    return ensureMarker(raw);
  };

  return { host, model, checkAvailability, generate, rerank, polish };
}
