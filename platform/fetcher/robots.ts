/** 最小 robots.txt 实现：只取 `User-agent: *` 分组，最长匹配，同长时 Allow 优先。 */

export type RobotsRules = { disallow: string[]; allow: string[] };

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let agents: string[] = [];
  let inRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (field === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "allow" && field !== "disallow") continue;
    inRules = true;
    if (!agents.includes("*") || !value) continue;
    rules[field].push(value);
  }
  return rules;
}

function patternRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let best = { length: -1, allow: true };
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]] as const) {
    for (const pattern of list) {
      if (!patternRegex(pattern).test(path)) continue;
      if (pattern.length > best.length || (pattern.length === best.length && allow)) best = { length: pattern.length, allow };
    }
  }
  return best.allow;
}
