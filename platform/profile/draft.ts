/** 由简历文本与意向描述生成档案草稿（结果总是经过归一化）。 */
import { HttpError } from "../http.ts";
import type { LlmProvider } from "../llm/types.ts";
import { buildDraftMessages } from "./prompt.ts";
import { normalizeGoalTarget, normalizeProfile } from "./schema.ts";
import type { GoalTarget, ProfileData } from "./schema.ts";

export async function draftFromInputs(
  llm: LlmProvider,
  input: { resumeText: string | null; intentText: string | null },
): Promise<{ profile: ProfileData; target: GoalTarget }> {
  if (!input.resumeText?.trim() && !input.intentText?.trim()) throw new HttpError(400, "请上传简历或填写意向描述");
  const { json } = await llm.completeJson(buildDraftMessages(input));
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return { profile: normalizeProfile(root.profile), target: normalizeGoalTarget(root.target) };
}
