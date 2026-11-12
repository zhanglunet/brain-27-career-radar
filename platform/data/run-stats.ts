/** 运行统计的解析（缺字段时补默认值）。 */
import { emptyStats } from "./scoped-find.ts";
import type { RunStats } from "./scoped-find.ts";

export function parseRunStats(json: string): RunStats {
  try {
    return { ...emptyStats(), ...(JSON.parse(json) as Partial<RunStats>) };
  } catch {
    return emptyStats();
  }
}
