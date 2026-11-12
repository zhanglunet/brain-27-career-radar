/**
 * 档案 / 目标画像与表单的互转。列表字段每行一条，列用 " | " 分隔，列顺序固定；
 * 结果总是再经过归一化。
 */
import { normalizeGoalTarget, normalizeProfile } from "./schema.ts";
import type { GoalTarget, ProfileData } from "./schema.ts";

const SEP = " | ";
const OUTPUT_LABELS: Record<string, string> = { paper: "论文", award: "奖项", project: "项目", other: "其他" };
const OUTPUT_KINDS_BY_LABEL: Record<string, string> = { 论文: "paper", 奖项: "award", 项目: "project", 其他: "other" };

const cell = (value: string | null) => value ?? "";

function rows(value: string | null, columns: number): (string | null)[][] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const head = parts.slice(0, columns - 1);
      const tail = parts.slice(columns - 1).join(SEP);
      const filled = [...head, tail];
      while (filled.length < columns) filled.push("");
      return filled.map((part) => part || null);
    });
}

const lines = (value: string | null) => (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export function profileToForm(profile: ProfileData): Record<string, string> {
  return {
    name: cell(profile.basics.name),
    location: cell(profile.basics.location),
    education: profile.education.map((e) => [e.school, e.degree, e.major, e.period].map(cell).join(SEP)).join("\n"),
    experience: profile.experience.map((e) => [e.org, e.title, e.period, e.highlight].map(cell).join(SEP)).join("\n"),
    skills: profile.skills.join("\n"),
    outputs: profile.outputs.map((o) => [OUTPUT_LABELS[o.kind], o.title, o.venue, o.year].map((v) => cell(v ?? null)).join(SEP)).join("\n"),
  };
}

export function formToProfile(form: URLSearchParams): ProfileData {
  return normalizeProfile({
    basics: { name: form.get("name"), location: form.get("location") },
    education: rows(form.get("education"), 4).map(([school, degree, major, period]) => ({ school, degree, major, period })),
    experience: rows(form.get("experience"), 4).map(([org, title, period, highlight]) => ({ org, title, period, highlight })),
    skills: lines(form.get("skills")),
    outputs: rows(form.get("outputs"), 4).map(([label, title, venue, year]) => ({ kind: OUTPUT_KINDS_BY_LABEL[label ?? ""] ?? "other", title, venue, year })),
  });
}

export function targetToForm(target: GoalTarget): Record<string, string | string[]> {
  return {
    kinds: [...target.kinds],
    directions: target.directions.join("\n"),
    cities: target.cities.join("\n"),
    timing: cell(target.timing),
    notes: cell(target.notes),
  };
}

export function formToTarget(form: URLSearchParams): GoalTarget {
  return normalizeGoalTarget({
    kinds: form.getAll("kinds").flatMap((value) => value.split(",")),
    directions: lines(form.get("directions")),
    cities: lines(form.get("cities")),
    timing: form.get("timing"),
    notes: form.get("notes"),
  });
}
