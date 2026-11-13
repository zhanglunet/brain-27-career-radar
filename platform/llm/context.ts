/** 路由取得大模型的唯一入口：先检查同意条款与 key，再包上每日额度。 */
import { requireConsent } from "../auth.ts";
import type { Ctx } from "../context.ts";
import { forUser } from "../data/scoped.ts";
import type { User } from "../data/tables.ts";
import { HttpError } from "../http.ts";
import { createDeepSeekProvider } from "./deepseek.ts";
import { withDailyQuota } from "./quota.ts";
import type { LlmProvider } from "./types.ts";

export async function llmFor(ctx: Ctx, user: User): Promise<LlmProvider> {
  await requireConsent(ctx, user);
  const inner = ctx.deps.llm ?? (ctx.env.DEEPSEEK_API_KEY
    ? createDeepSeekProvider({ apiKey: ctx.env.DEEPSEEK_API_KEY, fetch: ctx.deps.fetch ?? ((input, init) => fetch(input, init)) })
    : null);
  if (!inner) throw new HttpError(503, "智能体暂不可用");
  return withDailyQuota(inner, forUser(ctx.env.PRIVATE_DB, user.id), user.id, ctx.deps.now);
}
