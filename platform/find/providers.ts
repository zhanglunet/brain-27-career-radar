/**
 * 后台运行（队列消费者）取得大模型与搜索的入口：不依赖请求，按用户 ID 检查账号状态、
 * 当前条款同意与 key，再包上每日额度。
 */
import { CONSENT_VERSION } from "../consent.ts";
import { findUserById } from "../data/accounts.ts";
import { hasConsent } from "../data/consents.ts";
import { forUser } from "../data/scoped.ts";
import type { Deps, PlatformEnv } from "../env.ts";
import { createDeepSeekProvider } from "../llm/deepseek.ts";
import { withDailyQuota } from "../llm/quota.ts";
import type { LlmProvider } from "../llm/types.ts";
import { createBochaProvider } from "../search/bocha.ts";
import { withSearchQuota } from "../search/quota.ts";
import type { SearchProvider } from "../search/types.ts";

export type RunAbortReason = "inactive" | "no_consent" | "no_key" | "no_profile";

export class RunAbort extends Error {
  reason: RunAbortReason;

  constructor(reason: RunAbortReason) {
    super(reason);
    this.reason = reason;
  }
}

async function ensureEligible(env: PlatformEnv, userId: string): Promise<void> {
  const user = await findUserById(env.PRIVATE_DB, userId);
  if (!user || user.status !== "active") throw new RunAbort("inactive");
  if (!(await hasConsent(env.PRIVATE_DB, userId, CONSENT_VERSION))) throw new RunAbort("no_consent");
}

export async function llmForUserId(env: PlatformEnv, deps: Deps, userId: string): Promise<LlmProvider> {
  await ensureEligible(env, userId);
  const inner = deps.llm ?? (env.DEEPSEEK_API_KEY ? createDeepSeekProvider({ apiKey: env.DEEPSEEK_API_KEY, fetch: deps.fetch ?? ((input, init) => fetch(input, init)) }) : null);
  if (!inner) throw new RunAbort("no_key");
  return withDailyQuota(inner, forUser(env.PRIVATE_DB, userId), userId, deps.now);
}

export async function searchForUserId(env: PlatformEnv, deps: Deps, userId: string): Promise<SearchProvider> {
  await ensureEligible(env, userId);
  const inner = deps.search ?? (env.BOCHA_API_KEY ? createBochaProvider({ apiKey: env.BOCHA_API_KEY, fetch: deps.fetch ?? ((input, init) => fetch(input, init)) }) : null);
  if (!inner) throw new RunAbort("no_key");
  return withSearchQuota(inner, forUser(env.PRIVATE_DB, userId), userId, deps.now);
}
