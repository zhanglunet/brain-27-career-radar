/** 我的档案：简历上传 / 下载 / 删除，档案草稿生成、核对确认与回滚。 */
import { requireConsent, requireUser } from "../auth.ts";
import type { Ctx, Route } from "../context.ts";
import { resumeKey } from "../data/scoped-resumes.ts";
import { forUser } from "../data/scoped.ts";
import type { User } from "../data/tables.ts";
import { HttpError, escapeHtml, html, logEvent, readForm, redirect } from "../http.ts";
import { llmFor } from "../llm/context.ts";
import { LlmError } from "../llm/types.ts";
import { draftFromInputs } from "../profile/draft.ts";
import { ExtractError, extractResumeText } from "../profile/extract.ts";
import { formToProfile, formToTarget, profileToForm, targetToForm } from "../profile/form.ts";
import { OPPORTUNITY_KINDS } from "../profile/schema.ts";
import type { GoalTarget, ProfileData } from "../profile/schema.ts";
import { PDF_MIME, RESUME_MAX_BYTES, displayFilename, readUpload, sniffResumeType } from "../upload.ts";
import { layout, notice } from "../views.ts";

const MAX_RESUMES = 3;
const INTENT_MAX = 4000;

async function signedIn(ctx: Ctx): Promise<User> {
  const user = await requireUser(ctx);
  await requireConsent(ctx, user);
  return user;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function profilePage(ctx: Ctx, user: User, message = "", status = 200): Promise<Response> {
  const resumes = await forUser(ctx.env.PRIVATE_DB, user.id).resumes.list();
  const list = resumes.length
    ? `<ul class="cards">${resumes.map((resume) => `<li><strong>${escapeHtml(resume.filename)}</strong> <span class="muted">${formatSize(resume.size)}</span>
<p><a href="/resume/${encodeURIComponent(resume.id)}">下载</a></p>
<form method="post" action="/resume/${encodeURIComponent(resume.id)}/delete" style="margin:0"><button class="link" type="submit">删除</button></form></li>`).join("")}</ul>`
    : `<p class="muted">还没有上传简历。</p>`;
  const scope = forUser(ctx.env.PRIVATE_DB, user.id);
  const [current, pending, goals] = await Promise.all([scope.profile.current(), scope.drafts.listPending(), scope.goals.list()]);
  const currentHtml = current
    ? `<p class="muted">版本 ${current.version} · 确认于 ${new Date(current.confirmedAt).toISOString().slice(0, 10)}</p>${profileView(current.data)}
<form method="post" action="/profile/rollback"><button class="link" type="submit">恢复上一版</button></form>`
    : `<p class="muted">还没有确认过的档案。上传简历或写一段意向，让智能体先整理一份草稿。</p>`;
  const pendingHtml = pending.length
    ? `<h2>待确认的草稿</h2><ul>${pending.map((draft) => `<li><a href="/profile/drafts/${encodeURIComponent(draft.id)}">${new Date(draft.createdAt).toISOString().slice(0, 16).replace("T", " ")} 生成的草稿</a></li>`).join("")}</ul>`
    : "";
  const resumeOptions = resumes.map((resume) => `<option value="${encodeURIComponent(resume.id)}">${escapeHtml(resume.filename)}</option>`).join("");
  const goalOptions = goals.map((goal) => `<option value="${encodeURIComponent(goal.id)}">${escapeHtml(goal.title)}</option>`).join("");
  const body = `<h1>我的档案</h1>${message ? notice(message, "error") : ""}
<h2>当前档案</h2>${currentHtml}${pendingHtml}
<h2>让智能体整理草稿</h2>
<form method="post" action="/profile/draft">
<label>使用哪份简历<select name="resumeId"><option value="">不用简历</option>${resumeOptions}</select></label>
<label>对应哪个目标（会同时整理目标画像）<select name="goalId"><option value="">不对应目标</option>${goalOptions}</select></label>
<label>意向描述（可选，最多 ${INTENT_MAX} 字）<textarea name="intent" maxlength="${INTENT_MAX}" placeholder="想找什么方向、什么类型的机会，在哪些城市，什么时候"></textarea></label>
<p class="muted">提交后简历文本和意向描述会发送给 DeepSeek 整理，约需十几秒。</p>
<button type="submit">生成草稿</button></form>
<h2>简历</h2>${list}
<form method="post" action="/resume" enctype="multipart/form-data">
<label>上传简历（PDF 或 Word，不超过 5 MB，最多 ${MAX_RESUMES} 份）<input type="file" name="resume" accept=".pdf,.docx,application/pdf" required></label>
<button type="submit">上传</button></form>`;
  return html(layout("我的档案", body, user), status);
}

function profileView(profile: ProfileData): string {
  const rows: [string, string][] = [
    ["姓名", profile.basics.name ?? ""],
    ["所在地", profile.basics.location ?? ""],
    ["教育", profile.education.map((e) => [e.school, e.degree, e.major, e.period].filter(Boolean).join(" · ")).join("\n")],
    ["经历", profile.experience.map((e) => [e.org, e.title, e.period, e.highlight].filter(Boolean).join(" · ")).join("\n")],
    ["技能", profile.skills.join("、")],
    ["成果", profile.outputs.map((o) => [o.title, o.venue, o.year].filter(Boolean).join(" · ")).join("\n")],
  ];
  return `<table>${rows.map(([label, value]) => `<tr><th>${label}</th><td style="white-space:pre-line">${escapeHtml(value) || '<span class="muted">（空）</span>'}</td></tr>`).join("")}</table>`;
}

function textarea(label: string, name: string, value: string, hint: string): string {
  return `<label>${label}<span class="muted">${hint}</span><textarea name="${name}">${escapeHtml(value)}</textarea></label>`;
}

function input(label: string, name: string, value: string): string {
  return `<label>${label}<input name="${name}" value="${escapeHtml(value)}"></label>`;
}

function draftPage(user: User, draftId: string, profile: ProfileData, target: GoalTarget | null, message = "", status = 200): Response {
  const p = profileToForm(profile);
  const targetHtml = target
    ? (() => {
        const t = targetToForm(target);
        const kinds = OPPORTUNITY_KINDS.map((kind) => `<label style="display:inline-flex;gap:4px;align-items:center;margin-right:12px"><input type="checkbox" name="kinds" value="${kind}" style="width:auto"${(t.kinds as string[]).includes(kind) ? " checked" : ""}>${kind}</label>`).join("");
        return `<h2>目标画像</h2><div>${kinds}</div>${textarea("方向或岗位", "directions", t.directions as string, "每行一个")}${textarea("城市或地区", "cities", t.cities as string, "每行一个")}${input("时间（届别、入学或入职时间）", "timing", t.timing as string)}${textarea("其他要求", "notes", t.notes as string, "")}`;
      })()
    : "";
  const body = `<h1>核对档案草稿</h1>${message ? notice(message, "error") : ""}
${notice("以下内容由智能体根据你的材料整理，请逐项核对；没写到的信息保持空白即可。")}
<form method="post" action="/profile/drafts/${encodeURIComponent(draftId)}/confirm">
<h2>基本信息</h2>${input("姓名", "name", p.name)}${input("所在地", "location", p.location)}
${textarea("教育", "education", p.education, "每行一条：学校 | 学历 | 专业 | 时间")}
${textarea("经历", "experience", p.experience, "每行一条：单位 | 职位 | 时间 | 亮点")}
${textarea("技能", "skills", p.skills, "每行一个")}
${textarea("成果", "outputs", p.outputs, "每行一条：类型（论文 / 奖项 / 项目 / 其他）| 标题 | 发表处 | 年份")}
${targetHtml}
<button type="submit">确认并生效</button></form>
<form method="post" action="/profile/drafts/${encodeURIComponent(draftId)}/discard"><button class="link" type="submit">丢弃这份草稿</button></form>`;
  return html(layout("核对档案草稿", body, user), status);
}

export const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/profile$/,
    async handler(ctx) {
      return profilePage(ctx, await signedIn(ctx));
    },
  },
  {
    method: "POST",
    pattern: /^\/resume$/,
    async handler(ctx) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      let upload;
      try {
        upload = await readUpload(ctx.request, "resume", RESUME_MAX_BYTES);
      } catch (error) {
        if (error instanceof HttpError) return profilePage(ctx, user, error.message, error.status);
        throw error;
      }
      const mime = upload.bytes.length ? sniffResumeType(upload.bytes, upload.filename) : null;
      if (!mime) return profilePage(ctx, user, "只支持 PDF 或 Word（.docx）格式的简历。", 400);
      if ((await scope.resumes.count()) >= MAX_RESUMES) return profilePage(ctx, user, `最多保存 ${MAX_RESUMES} 份简历，请先删除旧的。`, 400);
      const id = crypto.randomUUID();
      await ctx.env.RESUMES.put(resumeKey(user.id, id), upload.bytes, { httpMetadata: { contentType: mime } });
      await scope.resumes.create({ id, filename: displayFilename(upload.filename), mime, size: upload.bytes.length }, ctx.deps.now());
      logEvent("platform.resume.upload", { userId: user.id, count: upload.bytes.length });
      return redirect("/profile");
    },
  },
  {
    method: "GET",
    pattern: /^\/resume\/([0-9a-f-]+)$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const resume = await forUser(ctx.env.PRIVATE_DB, user.id).resumes.get(id);
      if (!resume) throw new HttpError(404, "简历不存在");
      const object = await ctx.env.RESUMES.get(resumeKey(user.id, id));
      if (!object) throw new HttpError(404, "简历不存在");
      const filename = resume.mime === PDF_MIME ? "resume.pdf" : "resume.docx";
      return new Response(object.body, {
        headers: { "Content-Type": resume.mime, "Content-Disposition": `attachment; filename="${filename}"` },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/resume\/([0-9a-f-]+)\/delete$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      if (!(await scope.resumes.get(id))) throw new HttpError(404, "简历不存在");
      await ctx.env.RESUMES.delete(resumeKey(user.id, id));
      await scope.resumes.remove(id);
      return redirect("/profile");
    },
  },
  {
    method: "POST",
    pattern: /^\/profile\/draft$/,
    async handler(ctx) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      const form = await readForm(ctx.request);
      const resumeId = (form.get("resumeId") ?? "").trim();
      const goalId = (form.get("goalId") ?? "").trim();
      let intent = (form.get("intent") ?? "").trim();
      if ([...intent].length > INTENT_MAX) return profilePage(ctx, user, `意向描述不能超过 ${INTENT_MAX} 字。`, 400);
      const goal = goalId ? await scope.goals.get(goalId) : null;
      if (goalId && !goal) throw new HttpError(404, "目标不存在");
      if (!intent && goal) intent = `${goal.title}\n${goal.description}`;
      const resume = resumeId ? await scope.resumes.get(resumeId) : null;
      if (resumeId && !resume) throw new HttpError(404, "简历不存在");
      // 先确认大模型可用（同意条款、key），再做简历转换，避免白白调用转换服务。
      const llm = await llmFor(ctx, user);
      let resumeText: string | null = null;
      if (resume) {
        const object = await ctx.env.RESUMES.get(resumeKey(user.id, resume.id));
        if (!object) throw new HttpError(404, "简历不存在");
        try {
          resumeText = await extractResumeText(ctx.env.AI, { bytes: new Uint8Array(await object.arrayBuffer()), filename: resume.filename, mime: resume.mime });
        } catch (error) {
          if (error instanceof ExtractError) return profilePage(ctx, user, error.message, 400);
          throw error;
        }
        await scope.resumes.setTextChars(resume.id, [...resumeText].length);
      }
      let draft;
      try {
        draft = await draftFromInputs(llm, { resumeText, intentText: intent || null });
      } catch (error) {
        if (error instanceof LlmError && error.kind === "too_long") return profilePage(ctx, user, "材料过长，智能体没能整理完。请精简简历或意向描述后重试。", 422);
        if (error instanceof LlmError) return profilePage(ctx, user, "智能体暂时不可用，请稍后再试。", 502);
        throw error;
      }
      const source = resumeText && intent ? "both" : resumeText ? "resume" : "intent";
      const id = await scope.drafts.create({ goalId: goal?.id ?? null, profile: draft.profile, target: draft.target, source }, ctx.deps.now());
      logEvent("platform.profile.draft", { userId: user.id, status: source });
      return redirect(`/profile/drafts/${id}`);
    },
  },
  {
    method: "GET",
    pattern: /^\/profile\/drafts\/([0-9a-f-]+)$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const draft = await forUser(ctx.env.PRIVATE_DB, user.id).drafts.get(id);
      if (!draft) throw new HttpError(404, "草稿不存在");
      if (draft.status !== "pending") return html(layout("草稿", notice("这份草稿已处理过。"), user), 409);
      return draftPage(user, draft.id, draft.profile, draft.goalId ? draft.target : null);
    },
  },
  {
    method: "POST",
    pattern: /^\/profile\/drafts\/([0-9a-f-]+)\/confirm$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      const draft = await scope.drafts.get(id);
      if (!draft) throw new HttpError(404, "草稿不存在");
      const form = await readForm(ctx.request);
      const now = ctx.deps.now();
      // 先占住草稿（带条件的单条 UPDATE），再写档案：重复提交只有第一次生效。
      if (!(await scope.drafts.decide(id, "confirmed", now))) return html(layout("草稿", notice("这份草稿已处理过。", "error"), user), 409);
      const version = await scope.profile.confirm(formToProfile(form), now);
      if (draft.goalId) await scope.goals.setTarget(draft.goalId, formToTarget(form));
      logEvent("platform.profile.confirm", { userId: user.id, count: version });
      return redirect("/profile");
    },
  },
  {
    method: "POST",
    pattern: /^\/profile\/drafts\/([0-9a-f-]+)\/discard$/,
    async handler(ctx, [id]) {
      const user = await signedIn(ctx);
      const scope = forUser(ctx.env.PRIVATE_DB, user.id);
      if (!(await scope.drafts.get(id))) throw new HttpError(404, "草稿不存在");
      await scope.drafts.decide(id, "discarded", ctx.deps.now());
      return redirect("/profile");
    },
  },
  {
    method: "POST",
    pattern: /^\/profile\/rollback$/,
    async handler(ctx) {
      const user = await signedIn(ctx);
      const version = await forUser(ctx.env.PRIVATE_DB, user.id).profile.rollback(ctx.deps.now());
      if (version === null) return profilePage(ctx, user, "没有可恢复的上一版。", 400);
      return redirect("/profile");
    },
  },
];
