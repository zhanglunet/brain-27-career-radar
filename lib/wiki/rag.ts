/**
 * PRD-017/T2 · Wiki RAG 检索层（trend #67）。
 *
 * T1 §四衔接：tags 做过滤面，confidence 做排序权重，status 做默认过滤，
 * body + title 做向量化文本，d1_evidence 做证据链。
 *
 * 向量化方案：零外部依赖的 TF-IDF（bigram 中文分词 + 英文词切分），余弦相似度排序。
 * 不引入 embedding 服务是刻意选择：T2 语料小（Wiki 条目量级），TF-IDF 足够；
 * WikiEmbedder 接口已预留，未来语料增大或需要语义检索时替换即可。
 *
 * 生产 D1 只读：本层只消费 WikiEntry[]，D1 行 → WikiEntry 的映射由 T5（trend #70）实现。
 */
import type {
  WikiEntry,
  WikiFunding,
  WikiOpportunityType,
  WikiRegion,
  WikiStatus,
} from "./schema.ts";
import { CONFIDENCE_WEIGHTS } from "./schema.ts";

// ── 分词 ──────────────────────────────────────────────────────────────────
// 中文：bigram（"脑机接口" → 脑机/机接/接口）+ 单字 unigram 兜底单字查询；
// 英文/数字：按词切分转小写。

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const WORD_RUN = /[a-z0-9]+(?:[._-][a-z0-9]+)*/g;

/** 切分文本为词项序列（含重复，供 TF 计数）。 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(WORD_RUN)) tokens.push(m[0]);
  for (const run of lower.matchAll(CJK_RUN)) {
    const chars = [...run[0]];
    for (const ch of chars) tokens.push(ch);
    for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
  }
  return tokens;
}

/** 条目参与向量化的文本（T1：body + title 做向量化文本，另加方向关键词）。 */
export function entryText(entry: WikiEntry): string {
  const keywords = (entry.facets.keywords ?? []).join(" ");
  return `${entry.title}\n${entry.body}\n${keywords}`;
}

export type WikiIndex = {
  entries: WikiEntry[];
  /** entry id → 归一化 TF-IDF 向量（term → 权重）。 */
  vectors: Map<string, Map<string, number>>;
  /** term → 逆文档频率（供查询向量使用）。 */
  idf: Map<string, number>;
};

/**
 * 预留：外部向量模型接口。T2 用内置 TF-IDF；未来需要语义检索时，
 * 实现本接口并替换 buildIndex 内的向量化一步即可，search 的过滤/排序逻辑不变。
 */
export type WikiEmbedder = {
  embed(texts: string[]): Promise<number[][]>;
};

/** 建索引：倒排统计 → TF-IDF → 单位化。 */
export function buildIndex(entries: WikiEntry[]): WikiIndex {
  const tokenized = entries.map((e) => tokenize(entryText(e)));
  const docCount = entries.length;

  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, f] of df) idf.set(term, Math.log((docCount + 1) / (f + 1)) + 1);

  const vectors = new Map<string, Map<string, number>>();
  entries.forEach((entry, i) => {
    const tf = new Map<string, number>();
    for (const t of tokenized[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of tf) {
      const w = (1 + Math.log(count)) * (idf.get(term) ?? 1);
      vec.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, w] of vec) vec.set(term, w / norm);
    vectors.set(entry.id, vec);
  });
  return { entries, vectors, idf };
}

// ── 检索 ──────────────────────────────────────────────────────────────────

export type SearchFacets = {
  type?: WikiOpportunityType;
  region?: WikiRegion;
  funding?: WikiFunding;
};

export type SearchOptions = {
  /** 结构化过滤面（枚举复用 PRD-018，见 schema.ts）。 */
  facets?: SearchFacets;
  /**
   * 状态过滤，默认只返 active（T1 纪律：expired 保留可追溯但默认过滤；
   * merged 是去重指针，不进检索）。
   */
  status?: WikiStatus | "all";
  /** 是否纳入 low 可信度条目。默认 false（T1 纪律：low 默认降权、不进 Top 结果）。 */
  includeLowConfidence?: boolean;
  limit?: number;
  /** 最低分阈值（默认 0，不过滤）。 */
  minScore?: number;
};

export type SearchHit = {
  entry: WikiEntry;
  /** 余弦相似度 × confidence 权重。 */
  score: number;
  /** 证据链：每条结果必带（T1 §四；PRD-018 设计原则：结果带 last_verified）。 */
  evidence: {
    source: string;
    source_url: string;
    d1_evidence: string | null;
    last_verified: string;
  };
};

const DEFAULT_LIMIT = 10;

/**
 * 自然语言检索，如 search(index, "脑机接口博士机会")。
 * 流程：状态过滤 → 可信度过滤 → facets 过滤 → 余弦相似度 × confidence 权重 → 排序截断。
 */
export function search(index: WikiIndex, query: string, options: SearchOptions = {}): SearchHit[] {
  const status = options.status ?? "active";
  const includeLow = options.includeLowConfidence ?? false;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? 0;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // 查询向量（TF-IDF，用索引的 idf；OOV 词取 idf 上限）。
  const docCount = index.entries.length;
  const qtf = new Map<string, number>();
  for (const t of queryTokens) qtf.set(t, (qtf.get(t) ?? 0) + 1);
  const qvec = new Map<string, number>();
  let qnorm = 0;
  for (const [term, count] of qtf) {
    const w = (1 + Math.log(count)) * (index.idf.get(term) ?? Math.log(docCount + 1) + 1);
    qvec.set(term, w);
    qnorm += w * w;
  }
  qnorm = Math.sqrt(qnorm) || 1;

  const hits: SearchHit[] = [];
  for (const entry of index.entries) {
    if (status !== "all" && entry.status !== status) continue;
    if (!includeLow && entry.confidence === "low") continue;
    const f = options.facets;
    if (f?.type !== undefined && entry.facets.type !== f.type) continue;
    if (f?.region !== undefined && entry.facets.region !== f.region) continue;
    if (f?.funding !== undefined && entry.facets.funding !== f.funding) continue;

    const dvec = index.vectors.get(entry.id);
    if (!dvec) continue;
    let dot = 0;
    for (const [term, qw] of qvec) {
      const dw = dvec.get(term);
      if (dw !== undefined) dot += (qw / qnorm) * dw;
    }
    const score = dot * (CONFIDENCE_WEIGHTS[entry.confidence] ?? 1);
    if (score <= 0 || score < minScore) continue;
    hits.push({
      entry,
      score,
      evidence: {
        source: entry.source,
        source_url: entry.source_url,
        d1_evidence: entry.d1_evidence,
        last_verified: entry.last_verified,
      },
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
