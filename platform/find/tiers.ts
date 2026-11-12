/** 来源层级与聚合平台识别。聚合平台在本阶段只记链接、不抓取。 */
import { hostOf } from "../fetcher/url.ts";

export const AGGREGATOR_DOMAINS = [
  "nowcoder.com",
  "shixiseng.com",
  "zhipin.com",
  "zhaopin.com",
  "51job.com",
  "liepin.com",
  "lagou.com",
  "linkedin.com",
  "yingjiesheng.com",
  "kanzhun.com",
] as const;

export type Tier = "L1" | "L2" | "L3" | "L4";

export const TIER_LABELS: Record<Tier, string> = {
  L1: "公开雷达 / 平台共享来源",
  L2: "搜索发现的官方页面",
  L3: "你添加的来源",
  L4: "来自第三方或聚合平台，待官方确认",
};

export function isAggregator(url: string): boolean {
  const host = hostOf(url);
  return AGGREGATOR_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
