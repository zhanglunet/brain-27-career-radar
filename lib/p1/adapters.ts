import { excerptAround, extractAnchors, extractFirstTagText, extractJsonLdObjects, extractMetaContent, htmlToText } from "./html.ts";
import type { CandidateDraft, EvidenceDraft, OpportunityKind, OpportunityStatus, SourceAdapter, SourceDocument } from "./types.ts";
import { canonicalizeUrl, sameRegistrableHost } from "./url.ts";

type SourceProfile = {
  adapterKey: string;
  organization: string;
  defaultKind?: OpportunityKind;
  mode: "detail" | "listing";
};

const SOURCE_PROFILES: Record<string, SourceProfile> = {
  "oppo-health-ml": { adapterKey: "oppo-job-detail", organization: "OPPO", defaultKind: "实习", mode: "detail" },
  "oppo-health-algorithm": { adapterKey: "oppo-job-detail", organization: "OPPO", defaultKind: "实习", mode: "detail" },
  "tsinghua-pcs": { adapterKey: "academic-detail", organization: "清华大学心理与认知科学系", defaultKind: "博士", mode: "detail" },
  "shlab-jobs": { adapterKey: "career-listing", organization: "上海人工智能实验室", mode: "listing" },
  "brainco-recruit": { adapterKey: "career-listing", organization: "BrainCo 强脑科技", mode: "listing" },
};

const RELEVANT_LINK = /(博士|实习|校招|招聘|岗位|科研助理|研究助理|research assistant|研究员|工程师|engineer|scientist|intern(?:ship)?|graduate|career|jobs?|position)/i;
const GENERIC_LINK_TITLES = /^(招聘|加入我们|社会招聘|校园招聘|社会招聘和校园招聘|职位列表|全部职位|查看岗位列表|查看更多)$/i;
const GENERIC_PAGE_TITLES = /^(新闻动态|招聘|校园招聘|社会招聘|职位详情|oppo招聘|brainco)$/i;
const CITY_NAMES = ["北京", "上海", "深圳", "杭州", "广州", "南京", "天津", "武汉", "成都", "苏州", "哈尔滨"];

const registry = new Map<string, SourceAdapter>([
  ["oppo-job-detail", detailAdapter("oppo-job-detail")],
  ["academic-detail", detailAdapter("academic-detail")],
  ["career-listing", listingAdapter("career-listing")],
]);

export function getAdapter(key: string): SourceAdapter | null {
  return registry.get(key) ?? null;
}

export function pilotProfile(sourceId: string): SourceProfile | null {
  return SOURCE_PROFILES[sourceId] ?? null;
}

function detailAdapter(key: string): SourceAdapter {
  return {
    key,
    mode: "detail",
    extract(document) {
      const profile = SOURCE_PROFILES[document.sourceId];
      if (!profile) return [];
      const text = htmlToText(document.html);
      const jsonLd = extractJsonLdObjects(document.html);
      const jobPosting = jsonLd.find((item) => String(item["@type"] ?? "").toLowerCase() === "jobposting");
      const jsonTitle = stringValue(jobPosting?.title);
      const heading = extractFirstTagText(document.html, "h1");
      const metaTitle = extractMetaContent(document.html, ["og:title", "twitter:title"]);
      const pageTitle = extractFirstTagText(document.html, "title");
      const extractedTitle = cleanTitle(jsonTitle ?? heading ?? metaTitle ?? pageTitle ?? "");
      const title = !extractedTitle || GENERIC_PAGE_TITLES.test(extractedTitle)
        ? document.sourceName
        : extractedTitle;
      const canonicalUrl = canonicalizeUrl(stringValue(jobPosting?.url) ?? document.finalUrl, document.finalUrl);
      if (!canonicalUrl || !title) return [];

      return [buildCandidate({
        document,
        canonicalUrl,
        title,
        organization: profile.organization,
        text,
        defaultKind: profile.defaultKind,
        titleExtractor: jsonTitle ? "json-ld" : heading ? "heading" : metaTitle ? "meta" : "heading",
        jobPosting,
      })];
    },
  };
}

function listingAdapter(key: string): SourceAdapter {
  return {
    key,
    mode: "listing",
    extract(document) {
      const profile = SOURCE_PROFILES[document.sourceId];
      const organization = profile?.organization ?? organizationFromSourceName(document.sourceName);
      const candidates: CandidateDraft[] = [];
      const seen = new Set<string>();
      for (const anchor of extractAnchors(document.html)) {
        const text = anchor.text.replace(/\s+/g, " ").trim();
        if (!isUsableListingLink(anchor.href, text)) continue;
        const title = normalizeListingTitle(text, organization);
        if (!title) continue;
        const canonicalUrl = canonicalizeUrl(anchor.href, document.finalUrl);
        if (!canonicalUrl || !sameRegistrableHost(canonicalUrl, document.finalUrl) || seen.has(canonicalUrl)) continue;
        seen.add(canonicalUrl);
        candidates.push(buildCandidate({
          document,
          canonicalUrl,
          title,
          organization,
          text,
          titleExtractor: "anchor",
        }));
        if (candidates.length >= 25) break;
      }

      return candidates;
    },
  };
}

function organizationFromSourceName(sourceName: string): string {
  return sourceName
    .replace(/(?:官方)?(?:校园招聘|校招|招聘|人才机会|职位|岗位|Careers?|Jobs?|Opportunities?).*$/i, "")
    .trim() || sourceName.trim();
}

function buildCandidate(input: {
  document: SourceDocument;
  canonicalUrl: string;
  title: string;
  organization: string;
  text: string;
  defaultKind?: OpportunityKind;
  titleExtractor: EvidenceDraft["extractor"];
  jobPosting?: Record<string, unknown>;
}): CandidateDraft {
  const title = input.title.slice(0, 240);
  const kind = inferKind(`${title} ${input.text}`, input.defaultKind);
  const location = inferLocation(input.jobPosting, input.text);
  const deadline = inferDeadline(input.jobPosting, input.text);
  const status = inferStatus(input.text, deadline);
  const evidence: EvidenceDraft[] = [
    makeEvidence("title", title, input.text, input.titleExtractor, input.titleExtractor === "json-ld" ? 95 : 82),
    makeEvidence("org", input.organization, input.text, "source-profile", 100),
    makeEvidence("url", input.canonicalUrl, input.canonicalUrl, input.titleExtractor === "anchor" ? "anchor" : "source-profile", 100),
  ];
  if (kind) evidence.push(makeEvidence("kind", kind, input.text, "text-rule", input.defaultKind ? 92 : 78));
  if (location) evidence.push(makeEvidence("location", location, input.text, "text-rule", 76));
  if (deadline) evidence.push(makeEvidence("deadline", deadline, input.text, "text-rule", 70));
  if (status) evidence.push(makeEvidence("status", status, input.text, "text-rule", 68));

  return {
    canonicalUrl: input.canonicalUrl,
    title,
    org: input.organization,
    kind,
    location,
    deadline,
    status,
    evidence,
    metadata: { adapterKey: input.document.adapterKey, sourceType: input.document.sourceType },
  };
}

function inferKind(value: string, fallback?: OpportunityKind): OpportunityKind | null {
  if (/联合培养|联培/.test(value)) return "联培博士";
  if (/博士|ph\.?d/i.test(value)) return "博士";
  if (/科研助理|研究助理|research assistant|psychology assistant/i.test(value)) return "科研助理";
  if (/实习|intern/i.test(value)) return "实习";
  if (/校招|应届|graduate|campus/i.test(value)) return "校招";
  if (/研究员|研究岗位|scientist|research/i.test(value)) return "研究岗位";
  return fallback ?? null;
}

function inferLocation(jobPosting: Record<string, unknown> | undefined, text: string): string | null {
  const jobLocation = stringValue(jobPosting?.jobLocation);
  const source = `${jobLocation ?? ""} ${text}`;
  const cities = CITY_NAMES.filter((city) => source.includes(city));
  return cities.length ? [...new Set(cities)].slice(0, 3).join(" / ") : null;
}

function inferDeadline(jobPosting: Record<string, unknown> | undefined, text: string): string | null {
  const validThrough = stringValue(jobPosting?.validThrough);
  if (validThrough) return validThrough.slice(0, 32);
  const context = /(?:截止(?:日期|时间)?|申请截止|报名时间|投递截止)[：:\s]*((?:20\d{2}[.\-/年])?\d{1,2}[.\-/月]\d{1,2}(?:日)?)/.exec(text);
  return context?.[1]?.replace(/年|月/g, "-").replace(/日/g, "").replace(/[./]/g, "-") ?? null;
}

function inferStatus(text: string, deadline: string | null): OpportunityStatus | null {
  if (/已截止|停止招聘|申请结束|报名结束/.test(text)) return "持续关注";
  if (/即将开放|待发布|敬请期待|尚未开放/.test(text)) return "等待开放";
  if (deadline || /立即申请|立即投递|正在招聘|在招|开放申请/.test(text)) return "立即行动";
  return null;
}

function makeEvidence(
  fieldName: EvidenceDraft["fieldName"],
  fieldValue: string,
  text: string,
  extractor: EvidenceDraft["extractor"],
  confidence: number,
): EvidenceDraft {
  return { fieldName, fieldValue, excerpt: excerptAround(text, fieldValue).slice(0, 500), extractor, confidence };
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s*[-_|｜].*$/, "").trim();
}

function isUsableListingLink(href: string, text: string): boolean {
  if (!RELEVANT_LINK.test(text) || GENERIC_LINK_TITLES.test(text)) return false;
  if (text.length < 4 || text.length > 180) return false;
  if (/[${}<>]/.test(href) || /\s/.test(href)) return false;
  return !/[${}]/.test(text);
}

function normalizeListingTitle(value: string, organization: string): string | null {
  const title = cleanTitle(value);
  if (!title || GENERIC_LINK_TITLES.test(title)) return null;
  if (/^intern$/i.test(title)) return `${organization} 实习项目`;
  return title;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map(stringValue).find(Boolean) ?? null;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringValue(record.name) ?? stringValue(record.addressLocality) ?? stringValue(record.url);
  }
  return null;
}
