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
import { lastFetchedAt } from "../data/page-cache.ts";
import { listPlatformSources } from "../data/shared-sources.ts";
import type { User } from "../data/tables.ts";
import type { Deps, FindMessage, PlatformEnv } from "../env.ts";
import { fetchPublicPage } from "../fetcher/page.ts";
import type { FetchedPage } from "../fetcher/page.ts";
import { normalizeUrl } from "../fetcher/url.ts";
import { HttpError, logEvent } from "../http.ts";
import { LLM_DAILY_CALLS, LLM_DAILY_TOKENS, shanghaiDay } from "../llm/quota.ts";
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
/** 每层先分到的抓取名额；空出的名额由其他层按顺序补足。 */
export const TIER_QUOTA = 4;
/** 运行开始 10 分钟后不再抓新页面，转去评估；13 分钟后连评估也不做（队列消费者墙钟上限 15 分钟）。 */
export const FETCH_BUDGET_MS = 10 * 60_000;
export const ASSESS_DEADLINE_MS = 13 * 60_000;
/** 剩余大模型额度不超过这些时停止抽取，把额度留给评估。 */
export const RESERVE_CALLS = 3;
export const RESERVE_TOKENS = 40_000;
const RISK_FLAGGED = "页面含可疑内容，已跳过";

type Candidate = { url: string; tier: Tier; publicOpp?: PublicOpportunityMatch };
type ExtractedLike = { title: string; requirements: string[] };

const squashTitle = (text: string) => text.replace(/[\s（）()【】\[\]·•\-—_]+/g, "").toLowerCase();

/** 公开机会页上若有多条机会，只采用与公开机会名称对应的那一条；对不上就不挂要求。 */
export function pickForPublic(extracted: ExtractedLike[], name: string): ExtractedLike | null {
  if (extracted.length === 1) return extracted[0];
  const target = squashTitle(name);
  return extracted.find((opp) => {
    const title = squashTitle(opp.title);
    return title.length >= 2 && (target.includes(title) || title.includes(target));
  }) ?? null;
}

/** 每层先取至多 TIER_QUOTA 个，再按层顺序用剩余候选补足到 limit。 */
export function pickCandidates(groups: Candidate[][], limit: number): Candidate[] {
  const picked: Candidate[] = [];
  const rest: Candidate[][] = [];
  for (const group of groups) {
    picked.push(...group.slice(0, TIER_QUOTA));
    rest.push(group.slice(TIER_QUOTA));
  }
  for (const group of rest) picked.push(...group);
  return picked.slice(0, limit);
}

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
  const startedAt = deps.now();
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

    const groups: Record<"L3" | "L1" | "L2", Candidate[]> = { L3: [], L1: [], L2: [] };
    const seen = new Set<string>();
    const linkOnly = async (url: string, title: string, sourceUrl: string) => {
      const key = normalizeUrl(url);
      if (!key) return;
      await scope.opportunities.upsert(goal.id, {
        key, title, org: null, url, tier: "L4", source: { url: sourceUrl, tier: "L4" }, location: null, kind: null,
        deadlineStatus: "unknown", deadlineDate: null, requirements: [], risk: null,
      }, deps.now());
    };
    /** 聚合平台一律只记链接；其余按层放进候选（同一网址只放一次）。 */
    const push = async (url: string, tier: "L3" | "L1" | "L2", title: string, publicOpp?: PublicOpportunityMatch) => {
      if (isAggregator(url)) return linkOnly(url, title, url);
      const key = normalizeUrl(url);
      if (!key || seen.has(key)) return;
      seen.add(key);
      groups[tier].push({ url, tier, publicOpp });
    };
    /** 同一层里最久没抓过的排前面，避免同一批来源长期占满名额。 */
    const rotate = async (list: Candidate[]) => {
      const fetched = await lastFetchedAt(env.PRIVATE_DB, list.map((c) => c.url));
      return list.map((c, index) => ({ c, index, at: fetched.get(c.url) ?? 0 })).sort((x, y) => x.at - y.at || x.index - y.index).map((x) => x.c);
    };

    // 2. 来源：L3 用户来源与以往搜索记下的 L2 官方页 → L1 共享来源与公开雷达 → L2 新的搜索结果
    for (const source of await scope.sources.list(goal.id)) {
      if (source.tier === "L4") await linkOnly(source.url, source.org ?? source.url, source.url);
      else await push(source.url, source.origin === "user" ? "L3" : "L2", source.org ?? source.url);
    }
    for (const source of await listPlatformSources(env.PRIVATE_DB)) await push(source.url, "L1", source.org ?? source.url);
    const terms = [...target.directions, ...target.cities, ...target.kinds];
    for (const opp of await searchPublicForEnv(env, terms, 20)) {
      const key = normalizeUrl(opp.url);
      if (!key) continue;
      if (isAggregator(opp.url)) {
        await linkOnly(opp.url, opp.name, opp.url);
        continue;
      }
      const deadline = publicDeadline(opp);
      await scope.opportunities.upsert(goal.id, {
        key, title: opp.name, org: opp.org, url: opp.url, tier: "L1", source: { url: opp.url, tier: "L1" }, location: opp.location, kind: opp.kind,
        deadlineStatus: deadline.status, deadlineDate: deadline.date, requirements: [], risk: opp.authenticityState === "suspicious" ? "公开雷达标记为可疑" : null,
      }, deps.now());
      await push(opp.url, "L1", opp.name, opp);
    }
    groups.L3 = await rotate(groups.L3);
    groups.L1 = await rotate(groups.L1);
    groups.L2 = await rotate(groups.L2);
    const newHits: Candidate[] = [];
    for (const query of queries) {
      try {
        for (const result of await guarded(() => search.search(query))) {
          if (isAggregator(result.url)) {
            await linkOnly(result.url, result.title, result.url);
            continue;
          }
          const key = normalizeUrl(result.url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          newHits.push({ url: result.url, tier: "L2" });
        }
      } catch (error) {
        if (error instanceof QuotaStop) break;
        if (error instanceof SearchError) stats.searchFailures += 1;
        else throw error;
      }
    }
    // 新的搜索结果排在以往记下的 L2 页面之前，保证每次都有新页面被抓取。
    const candidates = pickCandidates([groups.L3, groups.L1, [...newHits, ...groups.L2]], MAX_PAGES);

    // 3. 抓取与抽取
    const toAssess = new Set<string>();
    for (const candidate of candidates) {
      if (deps.now() - startedAt > FETCH_BUDGET_MS) {
        stats.stoppedByTime = true;
        break;
      }
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
      const used = await scope.usage.get(shanghaiDay(deps.now()));
      if (LLM_DAILY_CALLS - used.calls <= RESERVE_CALLS || LLM_DAILY_TOKENS - used.tokens <= RESERVE_TOKENS) {
        // 把剩余额度留给评估：已抽到的机会至少能得到判定。
        stats.stoppedByQuota = true;
        break;
      }
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
        const requirements = pickForPublic(extraction.opportunities, candidate.publicOpp.name)?.requirements ?? [];
        const deadline = publicDeadline(candidate.publicOpp);
        const change = await scope.opportunities.upsert(goal.id, {
          key, title: candidate.publicOpp.name, org: candidate.publicOpp.org, url: candidate.publicOpp.url, tier: "L1",
          source: { url: candidate.publicOpp.url, tier: "L1" }, location: candidate.publicOpp.location, kind: candidate.publicOpp.kind,
          deadlineStatus: deadline.status, deadlineDate: deadline.date, requirements, risk: null,
        }, deps.now());
        if (change.created || change.requirementsChanged) toAssess.add(key);
        continue;
      }
      // 搜索到的页面若被判为非官方，抽出的机会只能算"待官方确认"（L4），不能当作官方页面。
      const tier: Tier = candidate.tier === "L2" && !extraction.official ? "L4" : candidate.tier;
      for (const opp of extraction.opportunities) {
        const key = opportunityKey(opp.url, page.finalUrl, opp.title);
        const input: OpportunityInput = {
          key, title: opp.title, org: opp.org ?? extraction.org, url: opp.url, tier, source: { url: candidate.url, tier },
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
    // 补上以前没评估成的、或要求已变而评估过时的机会（本次有变化的排在前面）。
    for (const opp of await scope.opportunities.list(goal.id)) {
      if (opp.tier === "L4") continue;
      const assessed = opp.assessment?.items.map((item) => item.requirement) ?? null;
      if (!assessed || JSON.stringify(assessed) !== JSON.stringify(opp.requirements)) toAssess.add(opp.key);
    }
    if (!llmStopped && toAssess.size && deps.now() - startedAt <= ASSESS_DEADLINE_MS) {
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

    stats.stoppedByQuota = stats.stoppedByQuota || llmStopped;
    stats.opportunities = (await scope.opportunities.list(goal.id, { includeDismissed: true })).length;
    await scope.runs.finish(msg.runId, "done", stats, null, deps.now());
    logEvent("platform.find.done", { userId: msg.userId, count: stats.opportunities });
  } catch (error) {
    const reason = error instanceof RunAbort ? error.reason : error instanceof Error ? error.name : "error";
    await scope.runs.finish(msg.runId, "failed", stats, reason, deps.now());
    logEvent("platform.find.failed", { userId: msg.userId, reason });
  }
}

/** 每日刷新：每个用户每天最多一个目标，按"最久没跑过"轮转；单个用户入队失败不影响其他用户。 */
export async function enqueueDailyRuns(env: PlatformEnv, deps: Deps): Promise<number> {
  const byUser = new Map<string, string[]>();
  for (const { userId, goalId } of await listDailyCandidates(env.PRIVATE_DB, CONSENT_VERSION, deps.now())) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), goalId]);
  }
  let count = 0;
  for (const [userId, goalIds] of byUser) {
    try {
      const scope = forUser(env.PRIVATE_DB, userId);
      const status = await Promise.all(goalIds.map(async (goalId) => ({ goalId, today: await scope.runs.hasRunToday(goalId, deps.now()), last: (await scope.runs.latest(goalId))?.createdAt ?? 0 })));
      if (status.some((goal) => goal.today)) continue;
      const pick = status.sort((x, y) => x.last - y.last)[0];
      if (!pick) continue;
      const runId = await scope.runs.create(pick.goalId, "daily", deps.now());
      if (!runId) continue;
      await env.FIND_QUEUE.send({ runId, userId });
      count += 1;
    } catch (error) {
      logEvent("platform.find.daily_failed", { userId, reason: error instanceof Error ? error.name : "error" });
    }
  }
  logEvent("platform.find.daily", { count });
  return count;
}
