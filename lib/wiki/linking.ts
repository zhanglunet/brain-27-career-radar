/**
 * PRD-061/T3 · 历史关联（trend #277）。
 *
 * 新条目生成时自动跑三路关联：
 *   - 同机构（same_org）：机构名归一化一致（复用 T2 fuzzy-dedup.ts 的 normalizeOrg）
 *   - 同领域（same_field）：L3 关键词交集非空（facets.keywords，词表按 T1 以 WIKI_DIRECTIONS v0.1 为起点）
 *   - 同导师（same_mentor）：mentor 数组交集非空（T1 §五：mentor?: string[]，取不到→空数组不编造）
 *
 * 关联结果以"相关条目"区块（related: RelatedLink[]）挂在**新条目**上，
 * **绝不改动历史条目**（只读 history 数组，attachRelated 只返回新对象）。
 *
 * 纪律（PRD-061 非目标 + PRD-017 人工确认闸门）：
 * - 不动 schema.ts：RelatedLink / EntryWithRelated 等类型定义在本模块。
 * - 关联是"提议"不是"入库"：新条目本身要走 T4 流水线的 requireHumanConfirm，
 *   相关条目区块随新条目一起出现在人工确认界面，由人看过再入库。
 * - 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），node --test 可直接运行。
 */

import type { WikiEntry } from "./schema.ts";
import { normalizeOrg, type OrgOf } from "./fuzzy-dedup.ts";

// ── 关联类型 ──────────────────────────────────────────────────────────────

/** 关联类型：同机构 / 同领域 / 同导师。 */
export type RelationType = "same_org" | "same_field" | "same_mentor";

/** 单条关联：指向一条历史条目的链接。 */
export type RelatedLink = {
  /** 历史条目 id。 */
  id: string;
  /** 历史条目标题（人工确认时一眼可读）。 */
  title: string;
  /** 关联类型：多路命中时取最强一路（same_mentor > same_org > same_field），见 findRelated 注释。 */
  relation: RelationType;
  /** 命中依据：归一化机构名 / 共享关键词 / 共享导师名（多路命中时累加，不丢信息）。 */
  matchedOn: string[];
};

/** 挂了"相关条目"区块的新条目：WikiEntry 本体不变 + 加法字段（定义在本模块，不动 schema.ts）。 */
export type EntryWithRelated = WikiEntry & {
  related: RelatedLink[];
};

/** 导师名访问器（T1 §五 mentor?: string[] 预留在 McpOpportunity 扩展层）。 */
export type MentorOf = (entry: WikiEntry) => string[] | null;

// ── 导师提取（T1 §五 v0.1）────────────────────────────────────────────────

/**
 * 停用词：命中这些词说明抓到的是职务/机构词不是人名。
 * 名字定位时用它们切分窗口（见下），而不是整段丢弃——
 * "导师张三团队"里"张三"是真名，不能因为后面跟了"团队"就扔掉。
 */
const MENTOR_STOPWORDS = [
  "实验室", "研究所", "研究院", "学院", "大学", "中心", "团队", "课题组", "项目组",
  "研究", "导师",
];

/** 分隔符后连续 CJK 开头（6 字窗口）；教授前连续 CJK 结尾（6 字窗口）。 */
const CJK_RUN_START = /^(\p{Script=Han}{2,6})/u;
const CJK_RUN_END = /(\p{Script=Han}{2,6})$/u;

/** 窗口中最早出现的停用词；没有返回 null。 */
function firstStopword(w: string): { index: number; len: number } | null {
  let best: { index: number; len: number } | null = null;
  for (const s of MENTOR_STOPWORDS) {
    const i = w.indexOf(s);
    if (i !== -1 && (best === null || i < best.index)) best = { index: i, len: s.length };
  }
  return best;
}

/** 窗口中最后出现的停用词；没有返回 null。 */
function lastStopword(w: string): { index: number; len: number } | null {
  let best: { index: number; len: number } | null = null;
  for (const s of MENTOR_STOPWORDS) {
    const i = w.lastIndexOf(s);
    if (i !== -1 && (best === null || i > best.index)) best = { index: i, len: s.length };
  }
  return best;
}

/**
 * extractMentors：从标题+正文提取导师/PI 姓名（T1 §五 v0.1 规则）。
 *
 * - 匹配「导师|PI + 人名」「人名 + 教授」两类模式，多导师取数组；
 * - 提取不到 → 空数组（绝不编造）；
 * - 中文名取 2 字：分隔符后的窗口里，第一个停用词之前的 2 字
 *   （"导师张三团队"→"张三"；"导师张实验室"→停用词前不足 2 字→丢弃）；
 *   教授前的窗口里，最后一个停用词之后的 2 字
 *   （"研究团队王五教授"→"王五"；"神经科学实验室教授"→停用词后不足 2 字→丢弃）；
 * - "无/没/不/非 + 导师"（如"无导师信息"）不触发；
 * - 去重保序。
 *
 * 为什么取 2 字：分隔符后紧跟的往往是"姓名+动词"（如"导师张三招生"），
 * 贪心多取会把动词吃进来；取 2 字在新旧条目两侧一致，交集依然有效。
 *
 * 已知局限（v0.1，T5 验收前可调）：
 * 1. 3-4 字姓名被截断为前 2 字；同姓且名首字相同者会误判（如张三/张三丰）——
 *    同导师一路只是"候选建议"，最终走人工确认。
 * 2. 英文名只认 "PI + 大写开头单词"（如 PI John Smith）；"导师/教授"后的英文名不抓。
 * 3. 「特邀教授做报告」这类"教授"作普通名词的句子会误抓前 2 字（如"特邀"）——
 *    停用词只能挡住机构类词，挡不住所有场景；缓解靠人工确认。
 * 4. "导师信息待定"这类"导师"作普通名词+信息类词的句子会误抓（如"信息"）——同上。
 * 5. 单字名不支持（最少 2 字）。
 */
export function extractMentors(title: string, body: string): string[] {
  const text = `${title}\n${body}`;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = name.trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  // —— 后置：导师/PI + 人名（否定词开头的"无导师"不触发）——
  {
    const re = /(?<![无没不非])(?:导师[：:为是]?|PI)[\s:：]*/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const rest = text.slice(m.index + m[0].length);
      const wm = rest.match(CJK_RUN_START);
      if (!wm) continue;
      const sw = firstStopword(wm[1]);
      const name = sw === null ? wm[1].slice(0, 2) : wm[1].slice(0, sw.index);
      if (name.length < 2) continue;
      push(name);
    }
  }

  // —— 前置：人名 + 教授 ——
  {
    const re = /教授/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const wm = before.match(CJK_RUN_END);
      if (!wm) continue;
      const sw = lastStopword(wm[1]);
      const name =
        sw === null ? wm[1].slice(0, 2) : wm[1].slice(sw.index + sw.len, sw.index + sw.len + 2);
      if (name.length < 2) continue;
      push(name);
    }
  }

  // —— 英文：PI + 英文名（1-2 个大写开头单词）——
  {
    const re = /PI[\s:：]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) push(m[1]);
  }

  return out;
}

/** 关键词归一化：去首尾空白；ASCII 部分小写（CJK 不受影响）。 */
function normKeyword(k: string): string {
  return k.trim().toLowerCase();
}

// ── 三路关联 ──────────────────────────────────────────────────────────────

export type LinkOptions = {
  /** 机构名访问器；缺省 → 同机构一路直接为空（fail-safe，不猜）。 */
  orgOf?: OrgOf;
  /**
   * 导师名访问器；缺省 → 用 extractMentors(title, body) 从文本提取
   * （T1 §五 v0.1；提取不到就是空数组，同导师一路自然为空）。
   */
  mentorOf?: MentorOf;
  /** 每路返回上限，默认 5。 */
  perLaneCap?: number;
  /** 三路去重后的总上限，默认 10。 */
  totalCap?: number;
};

export const DEFAULT_PER_LANE_CAP = 5;
export const DEFAULT_TOTAL_CAP = 10;

/** 关联强度排序：导师最具体（同名导师极少撞车）> 机构 > 领域（最宽泛）。 */
const LANE_PRIORITY: Record<RelationType, number> = {
  same_mentor: 0,
  same_org: 1,
  same_field: 2,
};

/** 按 last_verified 降序（最新在前）；并列按 created 降序；再并列按 id 稳定。 */
function byRecency(a: WikiEntry, b: WikiEntry): number {
  if (a.last_verified !== b.last_verified)
    return a.last_verified < b.last_verified ? 1 : -1;
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

/**
 * findRelated：在历史条目中为新条目找三路关联。
 *
 * - history 数组只读：本函数不修改任何历史条目（也不修改 newEntry）；
 *   相关条目区块由 attachRelated 另行挂到新条目上。
 * - status 不过滤：expired 条目恰恰是"招生节奏"的观察对象（T1 §六：同机构看招生节奏），
 *   同领域/同导师同理看历史脉络——关联的是"情报"，不是"在招机会"。
 * - newEntry 自身（同 id）永远排除。
 * - 每路按时间倒序取前 perLaneCap；三路合并时同 id 只留一条（最强一路的 relation，
 *   matchedOn 累加各路证据）；最后按时间倒序截断到 totalCap。
 */
export function findRelated(
  newEntry: WikiEntry,
  history: WikiEntry[],
  opts: LinkOptions = {},
): RelatedLink[] {
  const perLaneCap = opts.perLaneCap ?? DEFAULT_PER_LANE_CAP;
  const totalCap = opts.totalCap ?? DEFAULT_TOTAL_CAP;

  const orgOf = opts.orgOf;
  const mentorOf: MentorOf =
    opts.mentorOf ?? ((e) => extractMentors(e.title, e.body));

  const past = history.filter((h) => h.id !== newEntry.id);

  // —— 同机构：归一化后一致（复用 T2 的 normalizeOrg，不另造）——
  const orgLinks: RelatedLink[] = [];
  if (orgOf) {
    const orgNew = orgOf(newEntry);
    if (orgNew) {
      const nNew = normalizeOrg(orgNew);
      for (const h of past) {
        const orgH = orgOf(h);
        if (!orgH) continue;
        const nH = normalizeOrg(orgH);
        if (nH === nNew) {
          orgLinks.push({
            id: h.id,
            title: h.title,
            relation: "same_org",
            matchedOn: [nH],
          });
        }
      }
    }
  }

  // —— 同领域：facets.keywords 交集非空（L3 词表按 T1 以 WIKI_DIRECTIONS v0.1 为起点）——
  const fieldLinks: RelatedLink[] = [];
  const kwNew = new Set((newEntry.facets.keywords ?? []).map(normKeyword));
  if (kwNew.size > 0) {
    for (const h of past) {
      const shared = (h.facets.keywords ?? [])
        .map(normKeyword)
        .filter((k) => k && kwNew.has(k));
      const uniq = [...new Set(shared)];
      if (uniq.length > 0) {
        fieldLinks.push({
          id: h.id,
          title: h.title,
          relation: "same_field",
          matchedOn: uniq,
        });
      }
    }
  }

  // —— 同导师：mentor 数组交集非空（取不到→空数组，该路自然为空，不编造）——
  const mentorLinks: RelatedLink[] = [];
  const mentorsNew = new Set(mentorOf(newEntry) ?? []);
  if (mentorsNew.size > 0) {
    for (const h of past) {
      const shared = (mentorOf(h) ?? []).filter((m) => mentorsNew.has(m));
      const uniq = [...new Set(shared)];
      if (uniq.length > 0) {
        mentorLinks.push({
          id: h.id,
          title: h.title,
          relation: "same_mentor",
          matchedOn: uniq,
        });
      }
    }
  }

  // 每路按时间倒序截断
  const byId = new Map<string, WikiEntry>();
  for (const h of past) byId.set(h.id, h);
  const trim = (links: RelatedLink[]) =>
    links
      .sort((a, b) => byRecency(byId.get(a.id)!, byId.get(b.id)!))
      .slice(0, perLaneCap);

  // 三路合并：同 id 只留一条 —— relation 取最强一路，matchedOn 累加各路证据
  const merged = new Map<string, RelatedLink>();
  for (const link of [...trim(mentorLinks), ...trim(orgLinks), ...trim(fieldLinks)]) {
    const cur = merged.get(link.id);
    if (!cur) {
      merged.set(link.id, { ...link, matchedOn: [...link.matchedOn] });
    } else {
      if (LANE_PRIORITY[link.relation] < LANE_PRIORITY[cur.relation]) {
        cur.relation = link.relation;
      }
      for (const m of link.matchedOn) {
        if (!cur.matchedOn.includes(m)) cur.matchedOn.push(m);
      }
    }
  }

  // 总上限：按时间倒序截断
  return [...merged.values()]
    .sort((a, b) => byRecency(byId.get(a.id)!, byId.get(b.id)!))
    .slice(0, totalCap);
}

/**
 * attachRelated：把关联结果挂到新条目上，返回**新对象**。
 *
 * - 不修改传入的 entry（浅拷贝 + facets/keywords/related 深拷贝一层）；
 * - 历史条目碰都不碰：findRelated 本来就没改它们，这里也不改。
 * - 人工确认消费点（T4 流水线）：返回的 EntryWithRelated 随新条目一起进
 *   requireHumanConfirm 待确认区，人在确认界面能看到"相关条目"区块再决定入库——
 *   关联结果本身不单独设 needsReview，因为新条目整体本来就是未确认状态。
 */
export function attachRelated(
  entry: WikiEntry,
  links: RelatedLink[],
): EntryWithRelated {
  return {
    ...entry,
    facets: {
      ...entry.facets,
      ...(entry.facets.keywords ? { keywords: [...entry.facets.keywords] } : {}),
    },
    related: links.map((l) => ({ ...l, matchedOn: [...l.matchedOn] })),
  };
}
