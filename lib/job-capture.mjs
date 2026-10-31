// PRD-260/T2（trend #1301）：求职实操录制管线——job-capture-v1 最小实现。
//
// 按 PRD-260/T1 设计（docs/plans/2026-10-28-prd-260-job-skills-recorder.md）实现 T2 范围：
//   字段白名单封闭：顶层 {schema, captured_at, jobseeker, task_kind, steps, summary}；
//   step 仅 {seq, surface_kind, action, intent, field_kind, pi_involved}——
//   **PII 在模型中无字段可装**：涉及个人信息的步骤只记 pi_involved=true（布尔），值永不入模型；
//   禁止字段出现即录制失败（白名单丢弃+告警不适用于值类禁录——检测到即抛）；
//   脱敏 J-1~J-4 阻断式（记录前）：J-1 邮箱/手机/证件；J-2 疑似简历句式；J-3 带 token URL；J-4 内部词替换。
//   全程本地零网络。虚构纪律：示例任务/解说全虚构；密钥样例占位形态。
export const SCHEMA = "job-capture-v1";

const RECORDING_FIELDS = ["schema", "captured_at", "jobseeker", "task_kind", "steps", "summary"];
const STEP_FIELDS = ["seq", "surface_kind", "action", "intent", "field_kind", "pi_involved"];
const SURFACE_KINDS = ["site-form", "doc", "listing", "other"];
const FIELD_KINDS = ["select", "text", "file", "checkbox", "none"];
const TASK_KINDS = ["form-navigation", "resume-check", "listing-triage", "other"];

// J-1 个人信息模式（邮箱/手机/证件）
const J1_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /(?<!\d)\d{17}[0-9Xx](?!\d)/,
];
// J-2 疑似简历句式：长度>50 且含求职词
const J2_WORDS = ["工作经历", "教育背景", "求职意向", "自我评价", "项目经验", "熟练掌握"];
const J2_MIN_LEN = 50;
// J-3 带 token/session 的 URL
const J3_RE = /https?:\/\/\S*(token|session|auth)=[A-Za-z0-9._-]{8,}/i;
// J-4 内部词（占位词典；真实内部名不进仓）
const J4_WORDS = ["内部系统", "内网平台"];
const J4_RE = new RegExp(J4_WORDS.join("|"), "g");

// 值类禁录字段（出现即录制失败——比"丢弃"更严：内容类字段不允许存在）
const FORBIDDEN_FIELDS = ["form_value", "resume_text", "contact", "screenshot", "clipboard", "field_value", "value"];

export class CaptureBlocked extends Error {
  constructor(rule, detail) {
    super(`[${rule}] ${detail}`);
    this.rule = rule;
    this.detail = detail;
  }
}

function checkBlockers(text, where) {
  if (J1_PATTERNS.some((re) => re.test(text))) {
    throw new CaptureBlocked("J-1", `${where} 命中个人信息模式（邮箱/手机/证件号）`);
  }
  if (J3_RE.test(text)) {
    throw new CaptureBlocked("J-3", `${where} 命中带 token/session 的 URL`);
  }
  if (text.length > J2_MIN_LEN && J2_WORDS.some((w) => text.includes(w))) {
    throw new CaptureBlocked("J-2", `${where} 疑似简历句式（长度 ${text.length} > ${J2_MIN_LEN} 且含求职词）`);
  }
}

function applyJ4(text) {
  return text.replace(J4_RE, "<INTERNAL>");
}

export function newCapture(capturedAt, jobseeker, taskKind) {
  if (!TASK_KINDS.includes(taskKind)) {
    throw new CaptureBlocked("WHITELIST", `task_kind 必须是 ${TASK_KINDS.join("/")}`);
  }
  jobseeker = applyJ4(jobseeker);
  checkBlockers(jobseeker, "jobseeker");
  return { schema: SCHEMA, captured_at: capturedAt, jobseeker, task_kind: taskKind, steps: [], summary: "" };
}

export function addStep(cap, step) {
  if (cap.schema !== SCHEMA) throw new CaptureBlocked("SCHEMA", "capture 未初始化");
  const warnings = [];
  // 值类禁录字段：出现即失败（不静默丢弃——防止内容从侧门进入）
  const forbidden = Object.keys(step).filter((k) => FORBIDDEN_FIELDS.includes(k));
  if (forbidden.length) {
    throw new CaptureBlocked("FORBIDDEN", `值类禁录字段出现: ${forbidden.join(",")}（PII/内容不可入模型）`);
  }
  const extra = Object.keys(step).filter((k) => !STEP_FIELDS.includes(k));
  let cleaned = step;
  if (extra.length) {
    warnings.push(`丢弃非白名单字段: ${extra.join(",")}`);
    cleaned = Object.fromEntries(Object.entries(step).filter(([k]) => STEP_FIELDS.includes(k)));
  }
  for (const key of ["seq", "surface_kind"]) {
    if (!(key in cleaned)) throw new CaptureBlocked("WHITELIST", `缺少必填字段: ${key}`);
  }
  if (!SURFACE_KINDS.includes(cleaned.surface_kind)) {
    throw new CaptureBlocked("WHITELIST", `surface_kind 必须是 ${SURFACE_KINDS.join("/")}`);
  }
  cleaned.field_kind = cleaned.field_kind ?? "none";
  if (!FIELD_KINDS.includes(cleaned.field_kind)) {
    throw new CaptureBlocked("WHITELIST", `field_kind 必须是 ${FIELD_KINDS.join("/")}`);
  }
  cleaned.pi_involved = Boolean(cleaned.pi_involved);

  for (const field of ["action", "intent"]) {
    if (typeof cleaned[field] === "string") {
      checkBlockers(cleaned[field], field);
      const replaced = applyJ4(cleaned[field]);
      if (replaced !== cleaned[field]) warnings.push(`${field} 命中 J-4 替换`);
      cleaned[field] = replaced;
    }
  }
  cap.steps.push(cleaned);
  cap._warnings = (cap._warnings || []).concat(warnings);
  return cap;
}

export function finishCapture(cap, summary) {
  summary = applyJ4(summary);
  checkBlockers(summary, "summary");
  cap.summary = summary;
  const warnings = cap._warnings || [];
  delete cap._warnings;
  // 最终自检（双保险）：整包重扫
  const blob = JSON.stringify(cap);
  checkBlockers(blob, "最终自检");
  cap._warnings = warnings;
  return cap;
}

export function dumpCapture(cap) {
  const out = Object.fromEntries(Object.entries(cap).filter(([k]) => !k.startsWith("_")));
  return JSON.stringify(out, null, 2) + "\n";
}
