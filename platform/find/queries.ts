/**
 * 由目标与档案规划检索词。交给模型和搜索服务的只有方向、类型、城市、时间、学历、专业、技能，
 * 不含姓名、经历细节等身份信息；含档案姓名的检索词在代码层剔除。
 */
import type { LlmProvider } from "../llm/types.ts";
import type { GoalTarget, ProfileData } from "../profile/schema.ts";

export const MAX_QUERIES = 5;
const MAX_QUERY_CHARS = 60;

const SYSTEM = `你是求职与升学搜索助手。根据给出的目标信息，生成用于联网搜索的检索词，目的是找到机构**官方**的招聘页、校园招聘页或招生 / 项目页面。

规则：
1. 最多 5 条，每条不超过 30 个字，可以带"官网""招聘""校园招聘""招生""实习"等词。
2. 只根据给出的信息生成，不要编造机构名称。
3. 输出一个合法的 json 对象：{"queries": ["检索词1", "检索词2"]}，不要输出其他文字。`;

function material(input: { goal: { title: string; description: string }; target: GoalTarget; profile: ProfileData | null }): string {
  const { goal, target, profile } = input;
  const lines = [
    `目标标题：${goal.title}`,
    `目标描述：${goal.description}`,
    target.kinds.length ? `机会类型：${target.kinds.join("、")}` : "",
    target.directions.length ? `方向或岗位：${target.directions.join("、")}` : "",
    target.cities.length ? `城市或地区：${target.cities.join("、")}` : "",
    target.timing ? `时间：${target.timing}` : "",
  ];
  if (profile) {
    const degrees = profile.education.map((e) => [e.degree, e.major].filter(Boolean).join(" ")).filter(Boolean);
    if (degrees.length) lines.push(`学历与专业：${degrees.join("；")}`);
    if (profile.skills.length) lines.push(`技能：${profile.skills.slice(0, 10).join("、")}`);
  }
  return lines.filter(Boolean).join("\n");
}

function fallback(goal: { title: string }, target: GoalTarget): string[] {
  const kinds = target.kinds.length ? target.kinds : ["招聘"];
  const directions = target.directions.slice(0, 3);
  if (!directions.length) return [`${goal.title} 招聘 官网`];
  const city = target.cities[0] ?? "";
  return directions.map((direction, index) => [city, direction, kinds[index % kinds.length], "官网"].filter(Boolean).join(" ")).slice(0, 3);
}

export async function planQueries(
  llm: LlmProvider,
  input: { goal: { title: string; description: string }; target: GoalTarget; profile: ProfileData | null },
): Promise<string[]> {
  const { json } = await llm.completeJson([
    { role: "system", content: SYSTEM },
    { role: "user", content: material(input) },
  ]);
  const raw = json && typeof json === "object" && Array.isArray((json as { queries?: unknown }).queries) ? (json as { queries: unknown[] }).queries : [];
  const name = input.profile?.basics.name?.trim();
  const queries: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const query = [...item.replace(/\s+/g, " ").trim()].slice(0, MAX_QUERY_CHARS).join("");
    if (!query || queries.includes(query)) continue;
    if (name && query.includes(name)) continue;
    queries.push(query);
    if (queries.length >= MAX_QUERIES) break;
  }
  return queries.length ? queries : fallback(input.goal, input.target);
}
