/** 我的档案：简历上传 / 下载 / 删除。档案草稿与确认见后续路由。 */
import { requireConsent, requireUser } from "../auth.ts";
import type { Ctx, Route } from "../context.ts";
import { resumeKey } from "../data/scoped-resumes.ts";
import { forUser } from "../data/scoped.ts";
import type { User } from "../data/tables.ts";
import { HttpError, escapeHtml, html, logEvent, redirect } from "../http.ts";
import { PDF_MIME, RESUME_MAX_BYTES, displayFilename, readUpload, sniffResumeType } from "../upload.ts";
import { layout, notice } from "../views.ts";

const MAX_RESUMES = 3;

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
  const body = `<h1>我的档案</h1>${message ? notice(message, "error") : ""}
<h2>简历</h2>${list}
<form method="post" action="/resume" enctype="multipart/form-data">
<label>上传简历（PDF 或 Word，不超过 5 MB，最多 ${MAX_RESUMES} 份）<input type="file" name="resume" accept=".pdf,.docx,application/pdf" required></label>
<button type="submit">上传</button></form>`;
  return html(layout("我的档案", body, user), status);
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
];
