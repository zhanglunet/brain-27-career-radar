/** 目标详情：机会清单、找机会、来源管理、机会标记。所有目标 / 来源 / 机会都按本人校验。 */
import { requireConsent, requireUser } from "../auth.ts";
import type { Ctx, Route } from "../context.ts";
import type { FindRun, GoalSource, UserOpportunity } from "../data/scoped-find.ts";
import { forUser } from "../data/scoped.ts";
import type { Goal } from "../data/scoped.ts";
import type { User } from "../data/tables.ts";
import { startRun } from "../find/run.ts";
import { TIER_LABELS, isAggregator } from "../find/tiers.ts";
import { HttpError, escapeHtml, html, readForm, redirect } from "../http.ts";
import { layout, notice } from "../views.ts";

const RUN_STATUS: Record<FindRun["status"], string> = { queued: "排队中", running: "进行中", done: "完成于", failed: "失败" };
const RUN_ERRORS: Record<string, string> = {
  no_key: "智能体或搜索服务未配置",
  no_consent: "需要先同意数据条款",
  inactive: "账号已停用",
  no_profile: "目标画像缺失",
  stale: "超时未完成",
};
const DEADLINE: Record<UserOpportunity["deadlineStatus"], string> = { date: "截止", rolling: "滚动招聘", unknown: "截止日期未披露", closed: "已截止" };
const MARKS: [string, string][] = [["interested", "感兴趣"], ["dismissed", "不感兴趣"], ["done", "已处理"]];

const time = (ms: number | null) => (ms ? new Date(ms + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") : "");

async function signedIn(ctx: Ctx): Promise<User> {
  const user = await requireUser(ctx);
  await requireConsent(ctx, user);
  return user;
}

async function ownGoal(ctx: Ctx, user: User, goalId: string): Promise<Goal> {
  const goal = await forUser(ctx.env.PRIVATE_DB, user.id).goals.get(goalId);
  if (!goal) throw new HttpError(404, "目标不存在");
  return goal;
}

function runSummary(run: FindRun | null): string {
  if (!run) return `<p class="muted">还没有找过机会。</p>`;
  const when = run.status === "done" ? time(run.finishedAt) : run.status === "failed" ? `：${RUN_ERRORS[run.error ?? ""] ?? "运行出错"}` : "";
  const s = run.stats;
  const detail = run.status === "done" || run.status === "failed"
    ? `<p class="muted">检索词 ${s.queries} 条 · 抓取页面 ${s.pagesFetched} 个（跳过 ${s.pagesSkipped}，可疑 ${s.flaggedPages}）· 评估 ${s.assessed} 条 · 共 ${s.opportunities} 条机会${s.searchFailures ? ` · 搜索失败 ${s.searchFailures} 次` : ""}${s.stoppedByQuota ? " · 今日额度已用完，部分步骤未执行" : ""}</p>`
    : "";
  return `<p>最近一次：${RUN_STATUS[run.status]} ${escapeHtml(when)}</p>${detail}`;
}

function link(url: string, text: string): string {
  if (!/^https?:\/\//i.test(url)) return escapeHtml(text);
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(text)}</a>`;
}

function opportunityCard(opp: UserOpportunity): string {
  const meta = [opp.org, opp.location, opp.kind].filter(Boolean).map((value) => escapeHtml(value as string)).join(" · ");
  const deadline = opp.deadlineStatus === "date" && opp.deadlineDate ? `${DEADLINE.date} ${escapeHtml(opp.deadlineDate)}` : opp.deadlineStatus === "closed" && opp.deadlineDate ? `已于 ${escapeHtml(opp.deadlineDate)} 截止` : DEADLINE[opp.deadlineStatus];
  const a = opp.assessment;
  const table = a && a.items.length
    ? `<table><tr><th>要求原文</th><th>判定</th><th>依据</th></tr>${a.items.map((item) => `<tr><td>${escapeHtml(item.requirement)}</td><td>${item.status}</td><td>${escapeHtml(item.evidence ?? "")}</td></tr>`).join("")}</table>`
    : opp.requirements.length ? `<p class="muted">要求：${opp.requirements.map(escapeHtml).join("；")}</p>` : "";
  const reasons = a?.reasons.length ? `<p>匹配理由：${a.reasons.map(escapeHtml).join("；")}</p>` : "";
  const gaps = a?.gaps.length ? `<p>主要差距：${a.gaps.map(escapeHtml).join("；")}</p>` : "";
  const marks = MARKS.map(([value, label]) => `<form method="post" action="/opportunities/${encodeURIComponent(opp.id)}/mark" style="margin:0;display:inline"><input type="hidden" name="mark" value="${value}"><button class="link" type="submit"${opp.mark === value ? " disabled" : ""}>${label}</button></form>`).join(" · ");
  return `<li><strong>${link(opp.url, opp.title)}</strong>${a ? ` <span class="muted">匹配 ${a.score}</span>` : ""}
<p class="muted">${meta}${meta ? " · " : ""}${TIER_LABELS[opp.tier]} · ${deadline}</p>
${opp.risk ? notice(opp.risk, "error") : ""}${table}${reasons}${gaps}<p>${marks}</p></li>`;
}

function sourceRow(goalId: string, source: GoalSource): string {
  const base = `/goals/${encodeURIComponent(goalId)}/sources/${encodeURIComponent(source.id)}`;
  const nominate = source.tier !== "L4" && !source.nominatedAt
    ? ` · <form method="post" action="${base}/nominate" style="margin:0;display:inline"><button class="link" type="submit">允许分享给所有用户</button></form>`
    : source.nominatedAt ? ` · <span class="muted">已提交分享</span>` : "";
  return `<li>${link(source.url, source.org ? `${source.org}（${source.url}）` : source.url)} <span class="muted">${TIER_LABELS[source.tier]}</span>
<form method="post" action="${base}/delete" style="margin:0;display:inline"><button class="link" type="submit">删除</button></form>${nominate}</li>`;
}

async function goalPage(ctx: Ctx, user: User, goal: Goal, message = "", status = 200): Promise<Response> {
  const scope = forUser(ctx.env.PRIVATE_DB, user.id);
  const showAll = ctx.url.searchParams.get("all") === "1";
  const [run, opps, sources] = await Promise.all([scope.runs.latest(goal.id), scope.opportunities.list(goal.id, { includeDismissed: showAll }), scope.sources.list(goal.id)]);
  const target = goal.target
    ? `<p class="muted">${escapeHtml([goal.target.kinds.join("、"), goal.target.directions.join("、"), goal.target.cities.join("、"), goal.target.timing ?? ""].filter(Boolean).join(" · "))}</p>`
    : notice("这个目标还没有确认画像，请先到“我的档案”让智能体整理并确认。", "error");
  const body = `<h1>${escapeHtml(goal.title)}</h1>${message ? notice(message, "error") : ""}${target}
<h2>找机会</h2>${runSummary(run)}
<form method="post" action="/goals/${encodeURIComponent(goal.id)}/find"><button type="submit">找机会</button></form>
<p class="muted">每天早上 8 点也会自动刷新一次。</p>
<h2>机会（${opps.length}）</h2>
<p><a href="/goals/${encodeURIComponent(goal.id)}${showAll ? "" : "?all=1"}">${showAll ? "隐藏不感兴趣的" : "显示全部（含不感兴趣）"}</a></p>
${opps.length ? `<ul class="cards">${opps.map(opportunityCard).join("")}</ul>` : `<p class="muted">还没有机会。</p>`}
<h2>来源</h2>
${sources.length ? `<ul>${sources.map((s) => sourceRow(goal.id, s)).join("")}</ul>` : `<p class="muted">还没有添加来源。</p>`}
<p class="muted">分享来源后，管理员会看到这个网址，但看不到是谁分享的；审核通过后会用于所有用户的找机会。</p>
<form method="post" action="/goals/${encodeURIComponent(goal.id)}/sources">
<label>添加招聘页或公告网址<input name="url" required placeholder="https://"></label>
<label>机构名称（可选）<input name="org" maxlength="100"></label>
<button type="submit">添加来源</button></form>`;
  return html(layout(goal.title, body, user), status);
}

export const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/goals\/([0-9a-f-]+)$/,
    async handler(ctx, [goalId]) {
      const user = await signedIn(ctx);
      return goalPage(ctx, user, await ownGoal(ctx, user, goalId));
    },
  },
  {
    method: "POST",
    pattern: /^\/goals\/([0-9a-f-]+)\/find$/,
    async handler(ctx, [goalId]) {
      const user = await signedIn(ctx);
      const goal = await ownGoal(ctx, user, goalId);
      try {
        await startRun(ctx.env, ctx.deps, user, goal.id, "manual");
      } catch (error) {
        if (error instanceof HttpError && (error.status === 400 || error.status === 409)) return goalPage(ctx, user, goal, error.message, error.status);
        throw error;
      }
      return redirect(`/goals/${goal.id}`);
    },
  },
  {
    method: "POST",
    pattern: /^\/goals\/([0-9a-f-]+)\/sources$/,
    async handler(ctx, [goalId]) {
      const user = await signedIn(ctx);
      const goal = await ownGoal(ctx, user, goalId);
      const form = await readForm(ctx.request);
      const url = (form.get("url") ?? "").trim();
      const org = (form.get("org") ?? "").trim().slice(0, 100) || null;
      try {
        await forUser(ctx.env.PRIVATE_DB, user.id).sources.add(goal.id, { url, org, tier: isAggregator(url) ? "L4" : "L3", origin: "user" }, ctx.deps.now());
      } catch (error) {
        if (error instanceof HttpError && error.status === 400) return goalPage(ctx, user, goal, error.message, 400);
        throw error;
      }
      return redirect(`/goals/${goal.id}`);
    },
  },
  {
    method: "POST",
    pattern: /^\/goals\/([0-9a-f-]+)\/sources\/([0-9a-f-]+)\/delete$/,
    async handler(ctx, [goalId, sourceId]) {
      const user = await signedIn(ctx);
      const goal = await ownGoal(ctx, user, goalId);
      if (!(await forUser(ctx.env.PRIVATE_DB, user.id).sources.remove(goal.id, sourceId))) throw new HttpError(404, "来源不存在");
      return redirect(`/goals/${goal.id}`);
    },
  },
  {
    method: "POST",
    pattern: /^\/goals\/([0-9a-f-]+)\/sources\/([0-9a-f-]+)\/nominate$/,
    async handler(ctx, [goalId, sourceId]) {
      const user = await signedIn(ctx);
      const goal = await ownGoal(ctx, user, goalId);
      if (!(await forUser(ctx.env.PRIVATE_DB, user.id).sources.nominate(goal.id, sourceId, ctx.deps.now()))) throw new HttpError(404, "来源不存在或不能分享");
      return redirect(`/goals/${goal.id}`);
    },
  },
  {
    method: "POST",
    pattern: /^\/opportunities\/([0-9a-f-]+|[A-Za-z0-9_-]+)\/mark$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      const opp = await scope.opportunities.get(id);
      if (!opp) throw new HttpError(404, "机会不存在");
      const mark = (await readForm(ctx.request)).get("mark") ?? "";
      await scope.opportunities.mark(opp.id, mark);
      return redirect(`/goals/${opp.goalId}`);
    },
  },
];
