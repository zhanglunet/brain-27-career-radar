import { extractAnchors } from "./p1/html.ts";
import { canonicalizeUrl, sameRegistrableHost } from "./p1/url.ts";

const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES_PER_FEED = 80;
const BLOCKED_HOSTS = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|weibo|wechat|wikipedia|google|baidu|bing)\./i;
const GENERIC_TEXT = /^(home|首页|more|更多|read more|learn more|website|官网|link|链接|contact|联系我们|privacy|隐私|terms|条款)$/i;

type Trigger = "cron" | "manual" | "test";
type CandidateType = "company" | "research" | "mixed";
type FeedRow = {
  id: string;
  name: string;
  url: string;
  region: string;
  candidate_type: CandidateType;
  consecutive_failures: number;
};

export type OrganizationCandidate = {
  name: string;
  candidateUrl: string;
  canonicalHost: string;
  candidateType: CandidateType;
  confidence: number;
  evidenceExcerpt: string;
};

export type OrganizationDiscoverySummary = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  feedsChecked: number;
  candidatesFound: number;
  failedCount: number;
};

export function extractOrganizationCandidates(
  html: string,
  feedUrl: string,
  candidateType: CandidateType,
  knownHosts: ReadonlySet<string> = new Set(),
): OrganizationCandidate[] {
  const candidates: OrganizationCandidate[] = [];
  const seen = new Set<string>();
  for (const anchor of extractAnchors(html)) {
    const name = anchor.text.replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 140 || GENERIC_TEXT.test(name)) continue;
    const candidateUrl = canonicalizeUrl(anchor.href, feedUrl);
    if (!candidateUrl || sameRegistrableHost(candidateUrl, feedUrl)) continue;
    const parsed = new URL(candidateUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (BLOCKED_HOSTS.test(host) || knownHosts.has(host) || seen.has(candidateUrl)) continue;
    if (/\.(pdf|docx?|xlsx?|zip)$/i.test(parsed.pathname)) continue;
    seen.add(candidateUrl);
    candidates.push({
      name,
      candidateUrl,
      canonicalHost: host,
      candidateType,
      confidence: organizationConfidence(name, candidateType),
      evidenceExcerpt: `${name} → ${candidateUrl}`.slice(0, 500),
    });
    if (candidates.length >= MAX_CANDIDATES_PER_FEED) break;
  }
  return candidates;
}

export async function discoverOrganizations(
  db: D1Database,
  options: { trigger: Trigger; fetcher?: typeof fetch; now?: () => Date },
): Promise<OrganizationDiscoverySummary> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = crypto.randomUUID();
  await db.prepare(`INSERT INTO organization_discovery_runs (id,trigger,status,started_at) VALUES (?,?,'running',?)`)
    .bind(runId, options.trigger, startedAt).run();
  console.log(JSON.stringify({ event: "radar.organization_discovery.started", runId, trigger: options.trigger }));

  try {
    const feedQuery = db.prepare(`SELECT id,name,url,region,candidate_type,consecutive_failures
      FROM organization_discovery_feeds WHERE enabled=1
      ${options.trigger === "cron" ? "AND (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?, '-' || check_interval_hours || ' hours'))" : ""}
      ORDER BY id`);
    const feeds = await (options.trigger === "cron" ? feedQuery.bind(startedAt) : feedQuery).all<FeedRow>();
    const knownHosts = await loadKnownHosts(db);
    const errors: string[] = [];
    let candidatesFound = 0;

    for (const feed of feeds.results) {
      const checkedAt = now().toISOString();
      try {
        const response = await timedFetch(fetcher, feed.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await readBoundedText(response, MAX_BODY_BYTES);
        const candidates = extractOrganizationCandidates(html, response.url || feed.url, feed.candidate_type, knownHosts);
        for (const candidate of candidates) {
          await db.prepare(`INSERT INTO organization_candidates
            (id,feed_id,name,candidate_url,canonical_host,candidate_type,region,status,confidence,evidence_excerpt,first_seen_at,last_seen_at)
            VALUES (?,?,?,?,?,?,?,'candidate',?,?,?,?)
            ON CONFLICT(candidate_url) DO UPDATE SET name=excluded.name,last_seen_at=excluded.last_seen_at,
              confidence=MAX(organization_candidates.confidence,excluded.confidence),updated_at=CURRENT_TIMESTAMP`)
            .bind(stableId(candidate.candidateUrl), feed.id, candidate.name, candidate.candidateUrl,
              candidate.canonicalHost, candidate.candidateType, feed.region, candidate.confidence,
              candidate.evidenceExcerpt, checkedAt, checkedAt).run();
        }
        candidatesFound += candidates.length;
        await db.prepare(`UPDATE organization_discovery_feeds SET last_checked_at=?,last_success_at=?,last_status_code=?,
          consecutive_failures=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(checkedAt, checkedAt, response.status, feed.id).run();
        console.log(JSON.stringify({ event: "radar.organization_discovery.feed_succeeded", runId, feedId: feed.id, candidates: candidates.length }));
      } catch (error) {
        const message = errorMessage(error);
        errors.push(`${feed.id}: ${message}`);
        await db.prepare(`UPDATE organization_discovery_feeds SET last_checked_at=?,consecutive_failures=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(checkedAt, feed.consecutive_failures + 1, message, feed.id).run();
        console.error(JSON.stringify({ event: "radar.organization_discovery.feed_failed", runId, feedId: feed.id, error: message }));
      }
    }

    const checked = feeds.results.length;
    const failed = errors.length;
    const status = failed === 0 ? "succeeded" : failed === checked && checked > 0 ? "failed" : "partial";
    const finishedAt = now().toISOString();
    await db.prepare(`UPDATE organization_discovery_runs SET status=?,finished_at=?,feeds_checked=?,candidates_found=?,failed_count=?,error_summary=? WHERE id=?`)
      .bind(status, finishedAt, checked, candidatesFound, failed, errors.slice(0, 10).join("\n") || null, runId).run();
    const summary: OrganizationDiscoverySummary = { runId, status, feedsChecked: checked, candidatesFound, failedCount: failed };
    console.log(JSON.stringify({ event: "radar.organization_discovery.finished", ...summary }));
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    await db.prepare(`UPDATE organization_discovery_runs SET status='failed',finished_at=?,error_summary=? WHERE id=?`)
      .bind(now().toISOString(), message, runId).run();
    throw error;
  }
}

async function loadKnownHosts(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT url FROM sources UNION SELECT url FROM institutions`).all<{ url: string }>();
  return new Set(rows.results.flatMap((row) => {
    try { return [new URL(row.url).hostname.replace(/^www\./, "").toLowerCase()]; } catch { return []; }
  }));
}

async function timedFetch(fetcher: typeof fetch, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("organization discovery timed out"), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, { redirect: "follow", signal: controller.signal, headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "User-Agent": "Brain27CareerRadar/0.10 (+continuous-discovery)",
    } });
  } finally { clearTimeout(timeout); }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, limit);
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const slice = value.slice(0, limit - size);
    size += slice.byteLength;
    output += decoder.decode(slice, { stream: true });
    if (slice.byteLength < value.byteLength) { await reader.cancel(); break; }
  }
  return output + decoder.decode();
}

function organizationConfidence(name: string, type: CandidateType): number {
  const research = /(university|institute|laboratory|laboratories|centre|center|大学|学院|研究院|研究所|实验室|科学院)/i.test(name);
  const company = /(ltd|limited|inc\.?|company|group|technolog|公司|集团|科技)/i.test(name);
  return Math.min(95, 62 + (type === "research" && research ? 22 : 0) + (type === "company" && company ? 22 : 0));
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `org-candidate-${(hash >>> 0).toString(16)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
