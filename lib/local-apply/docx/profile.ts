/**
 * PRD-150/T2 · JobDocProfile —— 简历/求职信统一字段模型（本地）。
 *
 * 六区块字段表（T1 §1.2）：basics / education[] / experience[] / skills[] /
 * outputs[] / target。是 `~/.brain27/profile.json`（CliProfile）的**超集**：
 * 新增字段全部可选，老档案缺什么，渲染时留 `[待填写：字段路径]` 占位符，
 * 不强制迁移、不阻断生成（T1 §1.1 / §4.1）。
 *
 * ── 数据主权红线（T1 §五）──────────────────────────────────────
 * 1. 本模块不发起任何网络请求（无 fetch / 无 HTTP import）；
 * 2. 本模块不记录任何日志（无 console.*）；
 * 3. 入库的样例/测试数据一律虚构（见 examples/doc-profile.sample.json），
 *    真实档案只存在于用户本机 ~/.brain27/（不入库）。
 * ────────────────────────────────────────────────────────────
 *
 * 约定：只用可擦除 TypeScript 语法（无 enum / namespace），`node --test`
 * 可直接运行（与 matcher.ts 同一约定）。
 */

import type { WikiOpportunityType, WikiRegion } from "../../wiki/schema.ts";

// ── A. 基本信息（最敏感，绝不出机器）──────────────────────────

export type JobDocBasics = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  homepage?: string;
};

// ── B. 教育（degree 必选：现有 matcher/CLI 已依赖此语义）───────

export type JobDocEducation = {
  degree: string;
  school?: string;
  period?: string;
  note?: string;
};

// ── C. 经历（title/highlight 必选；star 仅为面试 STAR 映射预留形状）──

export type JobDocStar = {
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
};

export type JobDocExperience = {
  title: string;
  highlight: string;
  org?: string;
  period?: string;
  /** 备面试 STAR 映射（呼应 PRD-097 G15）；T2 不入版式，仅预留。 */
  star?: JobDocStar;
  tags?: string[];
};

// ── D. 技能（string 形态兼容现有 `skills: string[]`）───────────

export type JobDocSkill = string | { name: string; level?: string };

// ── E. 成果（可选，简历加分区块；整块为空则渲染时省略）─────────

export type JobDocOutput = {
  kind?: "paper" | "award" | "project";
  title?: string;
  venue?: string;
  year?: string;
  url?: string;
};

// ── F. 目标岗位（沿用 matcher.LocalProfile 语义，不新造词）─────

export type JobDocTarget = {
  researchInterests?: string[];
  targetTypes?: WikiOpportunityType[];
  targetRegions?: WikiRegion[];
  mentorsOfInterest?: string[];
  fundingNeed?: "full" | "partial" | "any";
};

/** 统一档案（T1 §1.2 六区块超集）。docx 生成直接读它。 */
export type JobDocProfile = {
  basics?: JobDocBasics;
  education?: JobDocEducation[];
  experience?: JobDocExperience[];
  skills?: JobDocSkill[];
  outputs?: JobDocOutput[];
  target?: JobDocTarget;
};

// ── 解析：老 profile.json（CliProfile 平铺形状）→ JobDocProfile ──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

function parseBasics(raw: Record<string, unknown>): JobDocBasics | undefined {
  const fromNested = isRecord(raw["basics"]) ? (raw["basics"] as Record<string, unknown>) : {};
  const b: JobDocBasics = {};
  const name = str(fromNested["name"] ?? raw["name"]); // 老档案平铺 name
  const email = str(fromNested["email"]);
  const phone = str(fromNested["phone"]);
  const location = str(fromNested["location"]);
  const homepage = str(fromNested["homepage"]);
  if (name) b.name = name;
  if (email) b.email = email;
  if (phone) b.phone = phone;
  if (location) b.location = location;
  if (homepage) b.homepage = homepage;
  return Object.keys(b).length > 0 ? b : undefined;
}

function parseEducation(raw: Record<string, unknown>): JobDocEducation[] | undefined {
  const arr = raw["education"];
  const out: JobDocEducation[] = [];
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (typeof item === "string") {
        // 宽容：一条字符串按"学位"处理（老档案 drafter.UserProfile.education 语义）。
        if (item.length > 0) out.push({ degree: item });
        continue;
      }
      if (!isRecord(item)) continue;
      const degree = str(item["degree"]);
      if (!degree) continue; // degree 必选，缺失的条目丢弃（渲染层对空数组留占位符）
      const edu: JobDocEducation = { degree };
      const school = str(item["school"]);
      const period = str(item["period"]);
      const note = str(item["note"]);
      if (school) edu.school = school;
      if (period) edu.period = period;
      if (note) edu.note = note;
      out.push(edu);
    }
  }
  if (out.length === 0) {
    // 老档案平铺 degree（CliProfile / matcher.LocalProfile）→ education[0].degree。
    const degree = str(raw["degree"]);
    if (degree) return [{ degree }];
    return undefined;
  }
  return out;
}

function parseExperience(raw: Record<string, unknown>): JobDocExperience[] | undefined {
  const arr = raw["experience"];
  if (!Array.isArray(arr)) return undefined;
  const out: JobDocExperience[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      // 老档案一句话经历（CliProfile.experience: string[]）→ highlight（T1 §1.2 C）。
      if (item.length > 0) out.push({ title: "", highlight: item });
      continue;
    }
    if (!isRecord(item)) continue;
    const highlight = str(item["highlight"]);
    if (!highlight) continue; // highlight 必选
    const exp: JobDocExperience = { title: str(item["title"]) ?? "", highlight };
    const org = str(item["org"]);
    const period = str(item["period"]);
    if (org) exp.org = org;
    if (period) exp.period = period;
    const tags = strArray(item["tags"]);
    if (tags) exp.tags = tags;
    if (isRecord(item["star"])) {
      const s = item["star"] as Record<string, unknown>;
      const star: JobDocStar = {};
      for (const key of ["situation", "task", "action", "result"] as const) {
        const v = str(s[key]);
        if (v) star[key] = v;
      }
      if (Object.keys(star).length > 0) exp.star = star;
    }
    out.push(exp);
  }
  return out.length > 0 ? out : undefined;
}

function parseSkills(raw: Record<string, unknown>): JobDocSkill[] | undefined {
  const arr = raw["skills"];
  if (!Array.isArray(arr)) return undefined;
  const out: JobDocSkill[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      if (item.length > 0) out.push(item);
      continue;
    }
    if (isRecord(item)) {
      const name = str(item["name"]);
      if (name) {
        const level = str(item["level"]);
        out.push(level ? { name, level } : { name });
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseOutputs(raw: Record<string, unknown>): JobDocOutput[] | undefined {
  const arr = raw["outputs"];
  if (!Array.isArray(arr)) return undefined;
  const out: JobDocOutput[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const o: JobDocOutput = {};
    const kind = str(item["kind"]);
    if (kind === "paper" || kind === "award" || kind === "project") o.kind = kind;
    const title = str(item["title"]);
    const venue = str(item["venue"]);
    const year = str(item["year"]);
    const url = str(item["url"]);
    if (title) o.title = title;
    if (venue) o.venue = venue;
    if (year) o.year = year;
    if (url) o.url = url;
    if (Object.keys(o).length > 0) out.push(o);
  }
  return out.length > 0 ? out : undefined;
}

function parseTarget(raw: Record<string, unknown>): JobDocTarget | undefined {
  const fromNested = isRecord(raw["target"]) ? (raw["target"] as Record<string, unknown>) : {};
  const t: JobDocTarget = {};
  const researchInterests = strArray(fromNested["researchInterests"] ?? raw["researchInterests"]);
  const mentorsOfInterest = strArray(fromNested["mentorsOfInterest"]);
  const targetTypes = strArray(fromNested["targetTypes"]);
  const targetRegions = strArray(fromNested["targetRegions"]);
  const fundingNeed = str(fromNested["fundingNeed"]);
  if (researchInterests) t.researchInterests = researchInterests;
  if (mentorsOfInterest) t.mentorsOfInterest = mentorsOfInterest;
  if (targetTypes) t.targetTypes = targetTypes as WikiOpportunityType[];
  if (targetRegions) t.targetRegions = targetRegions as WikiRegion[];
  if (fundingNeed === "full" || fundingNeed === "partial" || fundingNeed === "any") {
    t.fundingNeed = fundingNeed;
  }
  return Object.keys(t).length > 0 ? t : undefined;
}

/**
 * 宽容解析：接受 JobDocProfile 嵌套形状，也接受老档案平铺形状
 * （degree / researchInterests / skills / experience: string[] / name），
 * 映射关系按 T1 §1.3 兼容映射表。非法输入一律降级为空档案（渲染层
 * 对缺失必选字段留占位符，不抛错、不阻断生成）。
 */
export function parseJobDocProfile(raw: unknown): JobDocProfile {
  if (!isRecord(raw)) return {};
  const profile: JobDocProfile = {};
  const basics = parseBasics(raw);
  const education = parseEducation(raw);
  const experience = parseExperience(raw);
  const skills = parseSkills(raw);
  const outputs = parseOutputs(raw);
  const target = parseTarget(raw);
  if (basics) profile.basics = basics;
  if (education) profile.education = education;
  if (experience) profile.experience = experience;
  if (skills) profile.skills = skills;
  if (outputs) profile.outputs = outputs;
  if (target) profile.target = target;
  return profile;
}

// ── 展示辅助 ──────────────────────────────────────────────────

/** 技能条目 → 展示文本：`"Python"` / `"Python（熟练）"`。 */
export function skillLabel(skill: JobDocSkill): string {
  if (typeof skill === "string") return skill;
  return skill.level ? `${skill.name}（${skill.level}）` : skill.name;
}

/** 技能列表 → 顿号连接的一行（T1 §2.2：`{{skills[]}} 顿号连接`）。 */
export function skillsLine(skills: JobDocSkill[] | undefined): string {
  if (!skills || skills.length === 0) return "";
  return skills.map(skillLabel).join("、");
}

/** 成果条目 → 展示文本：`title · venue · year · url`（空字段连同分隔符跳过）。 */
export function outputLabel(output: JobDocOutput): string {
  return [output.title, output.venue, output.year, output.url]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" · ");
}
