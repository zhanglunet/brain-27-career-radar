const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 20;
const MAX_ACCEPTED = 5;
const TOPIC_KEYWORDS = ["brain", "neural", "neuron", "cognit", "memory", "learning", "decision", "intelligence", "interface", "hippocamp", "cort", "synap"];

export type EnabledPaperProvider = "crossref" | "europe_pmc";
export type PaperResearcher = { id: string; name: string };
export type PaperCandidate = {
  provider: EnabledPaperProvider;
  externalId: string;
  doi: string | null;
  pmid: string | null;
  arxivId: string | null;
  title: string;
  abstract: string;
  venue: string;
  publicationDate: string | null;
  paperType: "journal" | "conference" | "preprint" | "review" | "other";
  versionStatus: "published" | "preprint";
  sourceUrl: string;
  openAccessUrl: string | null;
  topics: string[];
  confidence: number;
  takeaway: string;
};

type CrossrefAuthor = { given?: string; family?: string; name?: string };
type CrossrefWork = {
  DOI?: string; title?: string[]; author?: CrossrefAuthor[]; published?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] }; "published-print"?: { "date-parts"?: number[][] };
  "container-title"?: string[]; type?: string; URL?: string; abstract?: string;
};
type EuropePmcAuthor = { firstName?: string; lastName?: string; fullName?: string; authorAffiliationDetailsList?: { authorAffiliation?: Array<{ affiliation?: string }> } };
type EuropePmcWork = {
  id?: string; pmid?: string; pmcid?: string; doi?: string; title?: string; abstractText?: string;
  authorList?: { author?: EuropePmcAuthor[] }; journalTitle?: string; firstPublicationDate?: string; pubYear?: string;
  pubTypeList?: { pubType?: string[] }; isOpenAccess?: "Y" | "N"; fullTextUrlList?: { fullTextUrl?: Array<{ url?: string }> };
};

export async function discoverProviderPapers(
  provider: EnabledPaperProvider,
  researcher: PaperResearcher,
  fetcher: typeof fetch,
  now: Date,
): Promise<PaperCandidate[]> {
  if (provider === "crossref") return discoverCrossref(researcher, fetcher, now);
  return discoverEuropePmc(researcher, fetcher, now);
}

async function discoverCrossref(researcher: PaperResearcher, fetcher: typeof fetch, now: Date): Promise<PaperCandidate[]> {
  const from = monthsAgo(now, 18);
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.author", researcher.name);
  url.searchParams.set("query.bibliographic", "brain neural cognition neuroscience memory learning decision intelligence interface");
  url.searchParams.set("filter", `from-pub-date:${date(from)}`);
  url.searchParams.set("select", "DOI,title,author,published,published-online,published-print,container-title,type,URL,abstract");
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  url.searchParams.set("rows", String(MAX_RESULTS));
  const payload = await fetchJsonWithRetry<{ message?: { items?: CrossrefWork[] } }>(url, fetcher, "Crossref");
  const candidates: PaperCandidate[] = [];
  for (const work of payload.message?.items ?? []) {
    const doi = work.DOI?.trim().toLowerCase();
    const title = cleanText(work.title?.[0]);
    if (!doi || !title || !hasMatchingAuthor(work.author ?? [], researcher.name)) continue;
    const relevance = topicRelevance(title);
    if (!relevance) continue;
    const parts = work.published?.["date-parts"]?.[0] ?? work["published-online"]?.["date-parts"]?.[0] ?? work["published-print"]?.["date-parts"]?.[0];
    candidates.push({
      provider: "crossref", externalId: doi, doi, pmid: null, arxivId: null, title,
      abstract: cleanText(work.abstract).slice(0, 4_000), venue: cleanText(work["container-title"]?.[0]),
      publicationDate: parts ? parts.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-") : null,
      paperType: crossrefType(work.type), versionStatus: work.type === "posted-content" ? "preprint" : "published",
      sourceUrl: work.URL ?? `https://doi.org/${doi}`, openAccessUrl: null, topics: relevance.matches,
      confidence: relevance.confidence, takeaway: `Crossref 自动发现；作者与主题匹配置信度 ${relevance.confidence}%，待进一步核验。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function discoverEuropePmc(researcher: PaperResearcher, fetcher: typeof fetch, now: Date): Promise<PaperCandidate[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", `AUTH:\"${researcher.name}\" AND FIRST_PDATE:[${date(monthsAgo(now, 18))} TO ${date(now)}] sort_date:y`);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(MAX_RESULTS));
  const payload = await fetchJson<{ resultList?: { result?: EuropePmcWork[] } }>(url, fetcher, "Europe PMC");
  const candidates: PaperCandidate[] = [];
  for (const work of payload.resultList?.result ?? []) {
    const doi = work.doi?.trim().toLowerCase() ?? null;
    const pmid = work.pmid?.trim() ?? null;
    const externalId = pmid ?? doi ?? work.id?.trim();
    const title = cleanText(work.title);
    if (!externalId || !title || !hasEuropePmcAuthor(work.authorList?.author ?? [], researcher)) continue;
    const relevance = topicRelevance(title);
    if (!relevance) continue;
    const openAccessUrl = work.isOpenAccess === "Y" ? work.fullTextUrlList?.fullTextUrl?.find((item) => item.url)?.url ?? null : null;
    candidates.push({
      provider: "europe_pmc", externalId, doi, pmid, arxivId: null, title,
      abstract: cleanText(work.abstractText).slice(0, 4_000), venue: cleanText(work.journalTitle),
      publicationDate: work.firstPublicationDate ?? (work.pubYear ? `${work.pubYear}-01-01` : null),
      paperType: europePmcType(work.pubTypeList?.pubType ?? []), versionStatus: "published",
      sourceUrl: pmid ? `https://europepmc.org/article/MED/${pmid}` : doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${externalId}`,
      openAccessUrl, topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `Europe PMC 自动发现；作者与神经科学主题匹配置信度 ${relevance.confidence}%，待进一步核验。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function fetchJson<T>(url: URL, fetcher: typeof fetch, label: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(`${label} request timed out`), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json", "User-Agent": "Brain27CareerRadar/0.4 (+https://radar.openagent.hk)" }, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}

async function fetchJsonWithRetry<T>(url: URL, fetcher: typeof fetch, label: string): Promise<T> {
  try { return await fetchJson<T>(url, fetcher, label); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 429")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    return fetchJson<T>(url, fetcher, `${label} retry`);
  }
}

function topicRelevance(title: string): { matches: string[]; confidence: number } | null {
  const lower = title.toLowerCase();
  const matches = TOPIC_KEYWORDS.filter((keyword) => lower.includes(keyword));
  const confidence = Math.min(95, 72 + matches.length * 6);
  return confidence >= 84 ? { matches, confidence } : null;
}

function hasMatchingAuthor(authors: CrossrefAuthor[], expected: string): boolean {
  return authors.some((author) => matchesName(author.name ?? [author.given, author.family].filter(Boolean).join(" "), expected));
}

function hasEuropePmcAuthor(authors: EuropePmcAuthor[], researcher: PaperResearcher): boolean {
  const hints = AFFILIATION_HINTS[researcher.id];
  return authors.some((author) => {
    if (!matchesName([author.firstName, author.lastName].filter(Boolean).join(" ") || author.fullName || "", researcher.name)) return false;
    if (!hints) return true;
    const affiliations = (author.authorAffiliationDetailsList?.authorAffiliation ?? []).map((item) => normalizeName(item.affiliation ?? "")).join(" ");
    return hints.some((hint) => affiliations.includes(normalizeName(hint)));
  });
}

function matchesName(actualValue: string, expectedValue: string): boolean {
  const actual = normalizeName(actualValue).split(" ");
  const expected = normalizeName(expectedValue).split(" ");
  const actualFirst = actual[0] ?? ""; const actualFamily = actual.at(-1) ?? "";
  const expectedFirst = expected[0] ?? ""; const expectedFamily = expected.at(-1) ?? "";
  return actual.join(" ") === expected.join(" ") || (actualFamily === expectedFamily && actualFirst[0] === expectedFirst[0]);
}

function crossrefType(value?: string): PaperCandidate["paperType"] {
  if (value === "journal-article") return "journal";
  if (value === "proceedings-article") return "conference";
  if (value === "posted-content") return "preprint";
  return "other";
}

function europePmcType(types: string[]): PaperCandidate["paperType"] {
  const text = types.join(" ").toLowerCase();
  if (text.includes("review")) return "review";
  if (text.includes("preprint")) return "preprint";
  return text.includes("journal") ? "journal" : "other";
}

function monthsAgo(value: Date, months: number): Date { const result = new Date(value); result.setUTCMonth(result.getUTCMonth() - months); return result; }
function date(value: Date): string { return value.toISOString().slice(0, 10); }
function cleanText(value?: string): string { return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function normalizeName(value: string): string { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }

const AFFILIATION_HINTS: Record<string, string[]> = {
  "r-jianfeng-feng": ["Fudan", "University of Warwick"],
  "r-bin-he": ["Carnegie Mellon", "University of Minnesota"],
  "r-luping-shi": ["Tsinghua"],
  "r-nancy-ip": ["Hong Kong University of Science and Technology", "HKUST"],
  "r-muming-poo": ["Chinese Academy of Sciences", "Institute of Neuroscience", "CEBSIT"],
  "r-edward-chang": ["University of California San Francisco", "UCSF"],
};
