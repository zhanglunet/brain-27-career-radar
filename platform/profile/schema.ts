/** 档案与目标画像的结构，以及对模型输出的严格归一化。没写的事实一律为 null / 空数组。 */

export const OPPORTUNITY_KINDS = ["校招", "社招", "实习", "博士", "硕士", "科研助理", "博士后", "其他"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

const OUTPUT_KINDS = ["paper", "award", "project", "other"] as const;
type OutputKind = (typeof OUTPUT_KINDS)[number];

export type Education = { school: string | null; degree: string | null; major: string | null; period: string | null };
export type Experience = { org: string | null; title: string | null; period: string | null; highlight: string | null };
export type Output = { kind: OutputKind; title: string | null; venue: string | null; year: string | null };

export type ProfileData = {
  basics: { name: string | null; location: string | null };
  education: Education[];
  experience: Experience[];
  skills: string[];
  outputs: Output[];
};

export type GoalTarget = {
  kinds: OpportunityKind[];
  directions: string[];
  cities: string[];
  timing: string | null;
  notes: string | null;
};

const SHORT = 200;
const LONG = 1000;
const MAX_ITEMS = 30;

function str(value: unknown, max = SHORT): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, max).join("") : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const mapped = map(item);
    if (mapped !== null) out.push(mapped);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function objectItem<T extends Record<string, unknown>>(item: unknown, build: (r: Record<string, unknown>) => T, keys: (keyof T)[]): T | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const built = build(item as Record<string, unknown>);
  return keys.some((key) => built[key] !== null) ? built : null;
}

const strings = (value: unknown) => list(value, (item) => str(item));

export function emptyProfile(): ProfileData {
  return { basics: { name: null, location: null }, education: [], experience: [], skills: [], outputs: [] };
}

export function normalizeProfile(raw: unknown): ProfileData {
  const root = record(raw);
  const basics = record(root.basics);
  return {
    basics: { name: str(basics.name), location: str(basics.location) },
    education: list(root.education, (item) =>
      objectItem(item, (r) => ({ school: str(r.school), degree: str(r.degree), major: str(r.major), period: str(r.period) }), ["school", "degree", "major", "period"])),
    experience: list(root.experience, (item) =>
      objectItem(item, (r) => ({ org: str(r.org), title: str(r.title), period: str(r.period), highlight: str(r.highlight, LONG) }), ["org", "title", "period", "highlight"])),
    skills: strings(root.skills),
    outputs: list(root.outputs, (item) =>
      objectItem(item, (r) => ({
        kind: (OUTPUT_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as OutputKind) : "other",
        title: str(r.title),
        venue: str(r.venue),
        year: str(r.year),
      }), ["title", "venue", "year"])),
  };
}

export function emptyGoalTarget(): GoalTarget {
  return { kinds: [], directions: [], cities: [], timing: null, notes: null };
}

export function normalizeGoalTarget(raw: unknown): GoalTarget {
  const root = record(raw);
  const kinds = Array.isArray(root.kinds)
    ? [...new Set(root.kinds.filter((kind): kind is OpportunityKind => (OPPORTUNITY_KINDS as readonly unknown[]).includes(kind)))]
    : [];
  return { kinds, directions: strings(root.directions), cities: strings(root.cities), timing: str(root.timing), notes: str(root.notes, LONG) };
}
