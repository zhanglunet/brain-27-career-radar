/**
 * 找机会运行：入队（startRun）→ 队列消费者执行（executeRun）→ 每日刷新（enqueueDailyRuns）。
 * 执行按固定预算进行；同一运行只会被认领一次，消息重投不会重复执行。
 */
import { CONSENT_VERSION } from "../consent.ts";
import { listDailyCandidates } from "../data/find-admin.ts";
import { emptyStats } from "../data/scoped-find.ts";
import type { OpportunityInput, RunStats, RunTrigger } from "../data/scoped-find.ts";
import { forUser } from "../data/scoped.ts";
import { searchPublicForEnv } from "../data/public-readonly.ts";
import type { PublicOpportunityMatch } from "../data/public-readonly.ts";
import { listPlatformSources } from "../data/shared-sources.ts";
import type { User } from "../data/tables.ts";
import type { Deps, FindMessage, PlatformEnv } from "../env.ts";
import { fetchPublicPage } from "../fetcher/page.ts";
import type { FetchedPage } from "../fetcher/page.ts";
import { normalizeUrl } from "../fetcher/url.ts";
import { HttpError, logEvent } from "../http.ts";
import { LlmError } from "../llm/types.ts";
import type { LlmProvider } from "../llm/types.ts";
import { emptyProfile } from "../profile/schema.ts";
import { SearchError } from "../search/types.ts";
import { assessOpportunities } from "./assess.ts";
import type { AssessInput } from "./assess.ts";
import { extractOpportunities } from "./extract.ts";
import type { DeadlineStatus } from "./extract.ts";
import { RunAbort, llmForUserId, searchForUserId } from "./providers.ts";
import { planQueries } from "./queries.ts";
import { isAggregator } from "./tiers.ts";
import type { Tier } from "./tiers.ts";

export const MAX_PAGES = 12;
export const MAX_ASSESS = 15;
const RISK_FLAGGED = "页面含可疑内容，已跳过";

type Candidate = { url: string; tier: Tier; publicOpp?: PublicOpportunityMatch };

export async function startRun(env: PlatformEnv, deps: Deps, user: User, goalId: string, trigger: RunTrigger): Promise<string> {
  const scope = forUser(env.PRIVATE_DB, user.id);
  const goal = await scope.goals.get(goalId);
  if (!goal) throw new HttpError(404, "目标不存在");
  if (!goal.target) throw new HttpError(400, "请先在我的档案里确认这个目标的画像");
  const runId = await scope.runs.create(goalId, trigger, deps.now());
  if (!runId) throw new HttpError(409, "这个目标正在找机会，请稍候");
  await env.FIND_QUEUE.send({ runId, userId: user.id });
  logEvent("platform.find.enqueued", { userId: user.id, status: trigger });
  return runId;
}

function publicDeadline(opp: PublicOpportunityMatch): { status: DeadlineStatus; date: string | null } {
  const date = opp.deadlineAt && /^\d{4}-\d{2}-\d{2}/.test(opp.deadlineAt) ? opp.deadlineAt.slice(0, 10) : null;
  if (opp.deadlineStatus === "confirmed" && date) return { status: "date", date };
  if (opp.deadlineStatus === "rolling") return { status: "rolling", date: null };
  if (opp.deadlineStatus === "closed") return { status: "closed", date };
  return { status: "unknown", date: null };
}

/** 页面本身作为机会地址时，用"页面地址#标题"作 key，避免同一列表页上的多条机会被合并。 */
function opportunityKey(url: string, pageUrl: string, title: string): string {
  const normalized = normalizeUrl(url) ?? url;
  const page = normalizeUrl(pageUrl) ?? pageUrl;
  return normalized === page ? `${page}#${title}` : normalized;
}

class QuotaStop extends Error {}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) throw new QuotaStop();
    throw error;
  }
}

export async function executeRun(env: PlatformEnv, deps: Deps, msg: FindMessage): Promise<void> {
  const scope = forUser(env.PRIVATE_DB, msg.userId);
  if (!(await scope.runs.claim(msg.runId, deps.now()))) return;
  const stats: RunStats = emptyStats();
  const fetchDeps = { now: deps.now, fetch: deps.fetch ?? fetch };
  try {
    const run = await scope.runs.get(msg.runId);
    const goal = run ? await scope.goals.get(run.goalId) : null;
    if (!run || !goal || !goal.target) throw new RunAbort("no_profile");
    const target = goal.target;
    const profile = (await scope.profile.current())?.data ?? emptyProfile();
    const llm: LlmProvider = await llmForUserId(env, deps, msg.userId);
    const search = await searchForUserId(env, deps, msg.userId);
    let llmStopped = false;

    // 1. 检索词
    let queries: string[] = [];
    try {
      queries = await guarded(() => planQueries(llm, { goal, target, profile }));
    } catch (error) {
      if (error instanceof QuotaStop) llmStopped = true;
      else if (!(error instanceof LlmError)) throw error;
    }
    stats.queries = queries.length;

    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const push = (url: string, tier: Tier, publicOpp?: PublicOpportunityMatch) => {
      const key = normalizeUrl(url);
      if (!key || seen.has(key)) return;
      seen.add(key);
      candidates.push({ url, tier, publicOpp });
    };
    const linkOnly = async (url: string, title: string, sourceUrl: string) => {
      const key = normalizeUrl(url);
      if (!key) return;
      await scope.opportunities.upsert(goal.id, {
        key, title, org: null, url, tier: "L4", source: { url: sourceUrl, tier: "L4" }, location: null, kind: null,
        deadlineStatus: "unknown", deadlineDate: null, requirements: [], risk: null,
      }, deps.now());
    };

    // 2. 来源：L3 用户来源（含以往搜索记下的 L2 官方页）→ L1 共享来源与公开雷达 → L2 搜索
    for (const source of await scope.sources.list(goal.id)) {
      if (source.tier === "L4" || isAggregator(source.url)) await linkOnly(source.url, source.org ?? source.url, source.url);
      else push(source.url, source.origin === "user" ? "L3" : "L2");
    }
    for (const source of await listPlatformSources(env.PRIVATE_DB)) push(source.url, "L1");
    const terms = [...target.directions, ...target.cities, ...target.kinds];
    for (const opp of await searchPublicForEnv(env, terms, 20)) {
      const deadline = publicDeadline(opp);
      const key = normalizeUrl(opp.url);
      if (!key) continue;
      await scope.opportunities.upsert(goal.id, {
        key, title: opp.name, org: opp.org, url: opp.url, tier: "L1", source: { url: opp.url, tier: "L1" }, location: opp.location, kind: opp.kind,
        deadlineStatus: deadline.status, deadlineDate: deadline.date, requirements: [], risk: opp.authenticityState === "suspicious" ? "公开雷达标记为可疑" : null,
      }, deps.now());
      push(opp.url, "L1", opp);
    }
    for (const query of queries) {
      try {
        for (const result of await guarded(() => search.search(query))) {
          if (isAggregator(result.url)) await linkOnly(result.url, result.title, result.url);
          else push(result.url, "L2");
        }
      } catch (error) {
        if (error instanceof QuotaStop) break;
        if (error instanceof SearchError) stats.searchFailures += 1;
        else throw error;
      }
    }

    // 3. 抓取与抽取
    const toAssess = new Set<string>();
    for (const candidate of candidates.slice(0, MAX_PAGES)) {
      const result = await fetchPublicPage(env, fetchDeps, candidate.url);
      if (!result.ok) {
        stats.pagesSkipped += 1;
        continue;
      }
      stats.pagesFetched += 1;
      const page: FetchedPage = result.page;
      if (page.flagged) {
        stats.flaggedPages += 1;
        await scope.opportunities.setRiskForSource(goal.id, candidate.url, RISK_FLAGGED, deps.now());
        continue;
      }
      if (llmStopped) continue;
      let extraction;
      try {
        extraction = await guarded(() => extractOpportunities(llm, page));
      } catch (error) {
        if (error instanceof QuotaStop) {
          llmStopped = true;
          continue;
        }
        if (error instanceof LlmError) continue;
        throw error;
      }
      if (candidate.publicOpp) {
        const key = normalizeUrl(candidate.publicOpp.url) as string;
        const requirements = extraction.opportunities[0]?.requirements ?? [];
        const deadline = publicDeadline(candidate.publicOpp);
        const change = await scope.opportunities.upsert(goal.id, {
          key, title: candidate.publicOpp.name, org: candidate.publicOpp.org, url: candidate.publicOpp.url, tier: "L1",
          source: { url: candidate.publicOpp.url, tier: "L1" }, location: candidate.publicOpp.location, kind: candidate.publicOpp.kind,
          deadlineStatus: deadline.status, deadlineDate: deadline.date, requirements, risk: null,
        }, deps.now());
        if (change.created || change.requirementsChanged) toAssess.add(key);
        continue;
      }
      for (const opp of extraction.opportunities) {
        const key = opportunityKey(opp.url, page.finalUrl, opp.title);
        const input: OpportunityInput = {
          key, title: opp.title, org: opp.org ?? extraction.org, url: opp.url, tier: candidate.tier, source: { url: candidate.url, tier: candidate.tier },
          location: opp.location, kind: opp.kind, deadlineStatus: opp.deadlineStatus, deadlineDate: opp.deadlineDate, requirements: opp.requirements, risk: null,
        };
        const change = await scope.opportunities.upsert(goal.id, input, deps.now());
        stats.extracted += 1;
        if (change.created || change.requirementsChanged) toAssess.add(key);
      }
      if (candidate.tier === "L2" && extraction.official) {
        await scope.sources.add(goal.id, { url: candidate.url, org: extraction.org, tier: "L2", origin: "search" }, deps.now()).catch(() => undefined);
      }
    }

    // 4. 评估
    if (!llmStopped && toAssess.size) {
      const inputs: AssessInput[] = [];
      for (const key of [...toAssess].slice(0, MAX_ASSESS)) {
        const opp = await scope.opportunities.getByKey(goal.id, key);
        if (opp) inputs.push({ key, title: opp.title, org: opp.org, requirements: opp.requirements, location: opp.location, kind: opp.kind });
      }
      try {
        const assessments = await guarded(() => assessOpportunities(llm, profile, target, inputs));
        for (const [key, assessment] of assessments) {
          await scope.opportunities.setAssessment(goal.id, key, assessment, deps.now());
          stats.assessed += 1;
        }
      } catch (error) {
        if (error instanceof QuotaStop) llmStopped = true;
        else if (!(error instanceof LlmError)) throw error;
      }
    }

    stats.stoppedByQuota = llmStopped;
    stats.opportunities = (await scope.opportunities.list(goal.id, { includeDismissed: true })).length;
    await scope.runs.finish(msg.runId, "done", stats, null, deps.now());
    logEvent("platform.find.done", { userId: msg.userId, count: stats.opportunities });
  } catch (error) {
    const reason = error instanceof RunAbort ? error.reason : error instanceof Error ? error.name : "error";
    await scope.runs.finish(msg.runId, "failed", stats, reason, deps.now());
    logEvent("platform.find.failed", { userId: msg.userId, reason });
  }
}

export async function enqueueDailyRuns(env: PlatformEnv, deps: Deps): Promise<number> {
  let count = 0;
  for (const { userId, goalId } of await listDailyCandidates(env.PRIVATE_DB, CONSENT_VERSION)) {
    const scope = forUser(env.PRIVATE_DB, userId);
    if (await scope.runs.hasRunToday(goalId, deps.now())) continue;
    const runId = await scope.runs.create(goalId, "daily", deps.now());
    if (!runId) continue;
    await env.FIND_QUEUE.send({ runId, userId });
    count += 1;
  }
  logEvent("platform.find.daily", { count });
  return count;
}
