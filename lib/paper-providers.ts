const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 20;
const MAX_ACCEPTED = 5;
const NCBI_REQUEST_GAP_MS = 400;
const TOPIC_KEYWORDS = ["brain", "neural", "neuron", "cognit", "memory", "learning", "decision", "intelligence", "interface", "hippocamp", "cort", "synap"];

export type EnabledPaperProvider = "crossref" | "europe_pmc" | "arxiv" | "pubmed" | "pmc" | "doaj";
export type PaperResearcher = { id: string; name: string };
export type PaperCandidate = {
  provider: EnabledPaperProvider;
  externalId: string;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
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
type DoajWork = {
  id?: string;
  bibjson?: {
    title?: string; abstract?: string; year?: string; month?: string;
    author?: Array<{ name?: string; affiliation?: string }>;
    identifier?: Array<{ type?: string; id?: string }>;
    journal?: { title?: string };
    link?: Array<{ type?: string; url?: string }>;
  };
};

export async function discoverProviderPapers(
  provider: EnabledPaperProvider,
  researcher: PaperResearcher,
  fetcher: typeof fetch,
  now: Date,
): Promise<PaperCandidate[]> {
  if (provider === "crossref") return discoverCrossref(researcher, fetcher, now);
  if (provider === "europe_pmc") return discoverEuropePmc(researcher, fetcher, now);
  if (provider === "arxiv") return discoverArxiv(researcher, fetcher, now);
  if (provider === "pubmed") return discoverNcbi("pubmed", researcher, fetcher, now);
  if (provider === "pmc") return discoverNcbi("pmc", researcher, fetcher, now);
  return discoverDoaj(researcher, fetcher, now);
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
      provider: "crossref", externalId: doi, doi, pmid: null, pmcid: null, arxivId: null, title,
      abstract: cleanText(work.abstract).slice(0, 4_000), venue: cleanText(work["container-title"]?.[0]),
      publicationDate: parts ? dateParts(parts) : null,
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
    const pmcid = normalizePmcid(work.pmcid);
    const externalId = pmid ?? pmcid ?? doi ?? work.id?.trim();
    const title = cleanText(work.title);
    if (!externalId || !title || !hasEuropePmcAuthor(work.authorList?.author ?? [], researcher)) continue;
    const relevance = topicRelevance(title);
    if (!relevance) continue;
    const openAccessUrl = work.isOpenAccess === "Y" ? work.fullTextUrlList?.fullTextUrl?.find((item) => item.url)?.url ?? null : null;
    candidates.push({
      provider: "europe_pmc", externalId, doi, pmid, pmcid, arxivId: null, title,
      abstract: cleanText(work.abstractText).slice(0, 4_000), venue: cleanText(work.journalTitle),
      publicationDate: work.firstPublicationDate ?? (work.pubYear ? `${work.pubYear}-01-01` : null),
      paperType: europePmcType(work.pubTypeList?.pubType ?? []), versionStatus: "published",
      sourceUrl: pmid ? `https://europepmc.org/article/MED/${pmid}` : pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${externalId}`,
      openAccessUrl, topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `Europe PMC 自动发现；作者与神经科学主题匹配置信度 ${relevance.confidence}%，待进一步核验。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function discoverArxiv(researcher: PaperResearcher, fetcher: typeof fetch, now: Date): Promise<PaperCandidate[]> {
  // arXiv does not expose affiliation metadata in Atom. Skip high-ambiguity names rather than creating unsafe matches.
  if (AFFILIATION_HINTS[researcher.id]) return [];
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `au:\"${researcher.name}\"`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(MAX_RESULTS));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  const xml = await fetchText(url, fetcher, "arXiv", "application/atom+xml");
  const candidates: PaperCandidate[] = [];
  for (const entry of blocks(xml, "entry")) {
    const names = blocks(entry, "author").map((author) => xmlText(author, "name"));
    if (!names.some((name) => matchesName(name, researcher.name))) continue;
    const title = xmlText(entry, "title");
    const published = xmlText(entry, "published").slice(0, 10) || null;
    if (!title || !withinMonths(published, now, 18)) continue;
    const relevance = topicRelevance(title);
    if (!relevance) continue;
    const rawId = xmlText(entry, "id");
    const arxivId = rawId.match(/\/abs\/([^?#]+)/)?.[1]?.replace(/v\d+$/, "") ?? null;
    if (!arxivId) continue;
    const doi = xmlAttributeText(entry, "arxiv:doi")?.toLowerCase() ?? null;
    candidates.push({
      provider: "arxiv", externalId: arxivId, doi, pmid: null, pmcid: null, arxivId, title,
      abstract: xmlText(entry, "summary").slice(0, 4_000), venue: "arXiv", publicationDate: published,
      paperType: "preprint", versionStatus: "preprint", sourceUrl: `https://arxiv.org/abs/${arxivId}`,
      openAccessUrl: `https://arxiv.org/pdf/${arxivId}`, topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `arXiv 自动发现预印本；作者与主题匹配置信度 ${relevance.confidence}%，需继续核验版本和正式发表记录。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function discoverNcbi(provider: "pubmed" | "pmc", researcher: PaperResearcher, fetcher: typeof fetch, now: Date): Promise<PaperCandidate[]> {
  const search = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  search.searchParams.set("db", provider);
  search.searchParams.set("term", `${researcher.name}[Author] AND (brain[Title/Abstract] OR neural[Title/Abstract] OR neuron[Title/Abstract] OR cognition[Title/Abstract] OR memory[Title/Abstract] OR learning[Title/Abstract] OR hippocampal[Title/Abstract] OR cortex[Title/Abstract])`);
  search.searchParams.set("retmode", "json");
  search.searchParams.set("retmax", String(MAX_RESULTS));
  search.searchParams.set("sort", "pub_date");
  search.searchParams.set("datetype", "pdat");
  search.searchParams.set("mindate", date(monthsAgo(now, 18)).replaceAll("-", "/"));
  search.searchParams.set("maxdate", date(now).replaceAll("-", "/"));
  addNcbiIdentity(search);
  const payload = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(search, fetcher, provider === "pubmed" ? "PubMed search" : "PMC search");
  const ids = payload.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];
  await pause(NCBI_REQUEST_GAP_MS);
  const fetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  fetchUrl.searchParams.set("db", provider);
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("retmode", "xml");
  addNcbiIdentity(fetchUrl);
  const xml = await fetchText(fetchUrl, fetcher, provider === "pubmed" ? "PubMed fetch" : "PMC fetch", "application/xml");
  return provider === "pubmed" ? parsePubmed(xml, researcher) : parsePmc(xml, researcher);
}

function parsePubmed(xml: string, researcher: PaperResearcher): PaperCandidate[] {
  const candidates: PaperCandidate[] = [];
  for (const article of blocks(xml, "PubmedArticle")) {
    const authorBlocks = blocks(article, "Author");
    if (!authorBlocks.some((author) => hasXmlAuthor(author, researcher, "ForeName", "LastName"))) continue;
    const title = xmlText(article, "ArticleTitle");
    const relevance = topicRelevance(title);
    const pmid = xmlText(article, "PMID") || null;
    if (!title || !relevance || !pmid) continue;
    const primaryIds = blocks(article, "ArticleIdList")[0] ?? "";
    const doi = articleId(primaryIds, "doi")?.toLowerCase() ?? null;
    const pmcid = normalizePmcid(articleId(primaryIds, "pmc"));
    const publicationDate = firstXmlDate(article, ["ArticleDate", "PubDate"]);
    const abstract = blocks(article, "AbstractText").map(stripXml).join(" ").slice(0, 4_000);
    const types = blocks(article, "PublicationType").map(stripXml);
    candidates.push({
      provider: "pubmed", externalId: pmid, doi, pmid, pmcid, arxivId: null, title, abstract,
      venue: xmlText(article, "Title"), publicationDate, paperType: europePmcType(types), versionStatus: "published",
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, openAccessUrl: pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` : null,
      topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `PubMed 自动发现；作者与主题匹配置信度 ${relevance.confidence}%，PMID 已保存并等待内容核验。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

function parsePmc(xml: string, researcher: PaperResearcher): PaperCandidate[] {
  const candidates: PaperCandidate[] = [];
  for (const article of blocks(xml, "article")) {
    const authorBlocks = blocks(article, "contrib").filter((block) => /contrib-type=["']author["']/.test(block));
    const hasAuthor = authorBlocks.some((author) => matchesName(`${xmlText(author, "given-names")} ${xmlText(author, "surname")}`, researcher.name));
    if (!hasAuthor || !affiliationAllowed(article, researcher)) continue;
    const title = xmlText(article, "article-title");
    const relevance = topicRelevance(title);
    const pmcid = normalizePmcid(articleId(article, "pmcid"));
    if (!title || !relevance || !pmcid) continue;
    const pmid = articleId(article, "pmid") || null;
    const doi = articleId(article, "doi")?.toLowerCase() ?? null;
    const abstract = blocks(article, "abstract").map(stripXml).join(" ").slice(0, 4_000);
    const subject = blocks(article, "subject").map(stripXml).join(" ");
    candidates.push({
      provider: "pmc", externalId: pmcid, doi, pmid, pmcid, arxivId: null, title, abstract,
      venue: xmlText(article, "journal-title"), publicationDate: firstXmlDate(article, ["pub-date"]),
      paperType: subject.toLowerCase().includes("review") ? "review" : "journal", versionStatus: "published",
      sourceUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`, openAccessUrl: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
      topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `PMC 自动发现开放全文记录；作者与主题匹配置信度 ${relevance.confidence}%，PMCID 已保存。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function discoverDoaj(researcher: PaperResearcher, fetcher: typeof fetch, now: Date): Promise<PaperCandidate[]> {
  const query = `bibjson.author.name:\"${researcher.name}\"`;
  const url = new URL(`https://doaj.org/api/v4/search/articles/${encodeURIComponent(query)}`);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(MAX_RESULTS));
  const payload = await fetchJson<{ results?: DoajWork[] }>(url, fetcher, "DOAJ");
  const candidates: PaperCandidate[] = [];
  for (const work of payload.results ?? []) {
    const bib = work.bibjson;
    const author = bib?.author?.find((item) => matchesName(item.name ?? "", researcher.name));
    if (!author || !affiliationTextAllowed(author.affiliation ?? "", researcher)) continue;
    const title = cleanText(bib?.title);
    const relevance = topicRelevance(title);
    const year = bib?.year?.match(/\d{4}/)?.[0];
    const publicationDate = year ? `${year}-${monthNumber(bib?.month) ?? "01"}-01` : null;
    if (!title || !relevance || !withinMonths(publicationDate, now, 18)) continue;
    const doi = bib?.identifier?.find((item) => item.type?.toLowerCase() === "doi")?.id?.toLowerCase() ?? null;
    const sourceUrl = bib?.link?.find((item) => item.url)?.url ?? (doi ? `https://doi.org/${doi}` : `https://doaj.org/article/${work.id}`);
    const externalId = work.id ?? doi;
    if (!externalId) continue;
    candidates.push({
      provider: "doaj", externalId, doi, pmid: null, pmcid: null, arxivId: null, title,
      abstract: cleanText(bib?.abstract).slice(0, 4_000), venue: cleanText(bib?.journal?.title), publicationDate,
      paperType: "journal", versionStatus: "published", sourceUrl,
      openAccessUrl: bib?.link?.find((item) => item.type === "fulltext")?.url ?? sourceUrl,
      topics: relevance.matches, confidence: relevance.confidence,
      takeaway: `DOAJ 自动发现开放获取文章；作者与主题匹配置信度 ${relevance.confidence}%，待核验期刊与作者身份。`,
    });
    if (candidates.length >= MAX_ACCEPTED) break;
  }
  return candidates;
}

async function fetchJson<T>(url: URL, fetcher: typeof fetch, label: string): Promise<T> {
  const response = await fetchResponse(url, fetcher, label, "application/json");
  return await response.json() as T;
}

async function fetchText(url: URL, fetcher: typeof fetch, label: string, accept: string): Promise<string> {
  const response = await fetchResponse(url, fetcher, label, accept);
  return response.text();
}

async function fetchResponse(url: URL, fetcher: typeof fetch, label: string, accept: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(`${label} request timed out`), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(url, { headers: { Accept: accept, "User-Agent": "Brain27CareerRadar/0.5 (+https://radar.openagent.hk; admin@openagent.hk)" }, signal: controller.signal });
    } finally { clearTimeout(timeout); }
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await response.arrayBuffer().catch(() => undefined);
      await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_250 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return response;
  }
  throw new Error(`${label} request exhausted retries`);
}

async function fetchJsonWithRetry<T>(url: URL, fetcher: typeof fetch, label: string): Promise<T> {
  try { return await fetchJson<T>(url, fetcher, label); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 429")) throw error;
    await pause(1_250);
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

function hasXmlAuthor(author: string, researcher: PaperResearcher, firstTag: string, lastTag: string): boolean {
  if (!matchesName(`${xmlText(author, firstTag)} ${xmlText(author, lastTag)}`, researcher.name)) return false;
  return affiliationTextAllowed(blocks(author, "Affiliation").map(stripXml).join(" "), researcher);
}

function affiliationAllowed(article: string, researcher: PaperResearcher): boolean {
  return affiliationTextAllowed(blocks(article, "aff").map(stripXml).join(" "), researcher);
}

function affiliationTextAllowed(value: string, researcher: PaperResearcher): boolean {
  const hints = AFFILIATION_HINTS[researcher.id];
  if (!hints) return true;
  const normalized = normalizeName(value);
  return hints.some((hint) => normalized.includes(normalizeName(hint)));
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

function blocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi"))].map((match) => match[0]);
}

function xmlText(xml: string, tag: string): string { return stripXml(blocks(xml, tag)[0] ?? ""); }
function xmlAttributeText(xml: string, tag: string): string | null { return xmlText(xml, tag) || null; }
function stripXml(value: string): string { return decodeXml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function decodeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const numeric = entity.slice(2, -1);
    const code = numeric[0]?.toLowerCase() === "x" ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function articleId(xml: string, type: string): string | null {
  const pattern = new RegExp(`<ArticleId\\b[^>]*IdType=["']${type}["'][^>]*>([\\s\\S]*?)<\\/ArticleId>|<article-id\\b[^>]*pub-id-type=["']${type}["'][^>]*>([\\s\\S]*?)<\\/article-id>`, "i");
  const match = xml.match(pattern);
  return match ? stripXml(match[1] ?? match[2] ?? "") || null : null;
}

function firstXmlDate(xml: string, tags: string[]): string | null {
  for (const tag of tags) {
    const block = blocks(xml, tag)[0];
    if (!block) continue;
    const year = xmlText(block, "Year") || xmlText(block, "year");
    if (!year) continue;
    const month = monthNumber(xmlText(block, "Month") || xmlText(block, "month")) ?? "01";
    const day = (xmlText(block, "Day") || xmlText(block, "day") || "01").padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function monthNumber(value?: string): string | null {
  if (!value) return null;
  const months: Record<string, string> = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
  const lower = value.slice(0, 3).toLowerCase();
  return months[lower] ?? (value.match(/^\d{1,2}$/) ? value.padStart(2, "0") : null);
}

function normalizePmcid(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.match(/\d+/)?.[0];
  return digits ? `PMC${digits}` : null;
}

function addNcbiIdentity(url: URL): void {
  url.searchParams.set("tool", "brain27_career_radar");
  url.searchParams.set("email", "admin@openagent.hk");
}

function withinMonths(value: string | null, now: Date, months: number): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed >= monthsAgo(now, months) && parsed <= now;
}

function dateParts(parts: number[]): string { return parts.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-"); }
function monthsAgo(value: Date, months: number): Date { const result = new Date(value); result.setUTCMonth(result.getUTCMonth() - months); return result; }
function date(value: Date): string { return value.toISOString().slice(0, 10); }
function cleanText(value?: string): string { return (value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function normalizeName(value: string): string { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim(); }
function pause(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

const AFFILIATION_HINTS: Record<string, string[]> = {
  "r-jianfeng-feng": ["Fudan", "University of Warwick"],
  "r-bin-he": ["Carnegie Mellon", "University of Minnesota"],
  "r-luping-shi": ["Tsinghua"],
  "r-nancy-ip": ["Hong Kong University of Science and Technology", "HKUST"],
  "r-muming-poo": ["Chinese Academy of Sciences", "Institute of Neuroscience", "CEBSIT"],
  "r-edward-chang": ["University of California San Francisco", "UCSF"],
  "r-fang-fang": ["Peking University", "PKU"],
  "r-huan-luo": ["Peking University", "PKU"],
  "r-yi-jiang": ["Chinese Academy of Sciences", "Institute of Psychology"],
  "r-huiguang-he": ["Chinese Academy of Sciences", "Institute of Automation"],
  "r-xiaorong-gao": ["Tsinghua University", "Tsinghua"],
};
