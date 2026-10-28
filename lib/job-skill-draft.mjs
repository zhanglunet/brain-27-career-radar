// PRD-260/T3（trend #1302）：清单技能草稿生成——job-capture-v1 时间线 → SKILL.md 兼容草稿。
//
// 按 PRD-260/T1 设计（docs/plans/2026-10-28-prd-260-job-skills-recorder.md §3.3）实现 T3 范围：
//   draftFromCapture(capture, {name, description}) → {frontmatter, bodyMarkdown, requiredGateLine}：
//     frontmatter 含 name/description/triggers{canonical(1 条), colloquial}/
//     review{state:"draft", reviewer:"", decided_at:""}/source:"recorded"；
//     body 为清单形态：适用场景 / 步骤清单（做什么+为什么+注意什么）/ 投递前置检查项；
//   **固定清单项（不可删）**：「任何投递/提交动作前，走 PRD-175 人工批准门」——生成器强制
//   插入并打 required 标记，函数返回值含 requiredGateLine；removeGateLine(body) 恒返回
//   false（闸门校验演示：required 固定项不可删，生成器与闸门双重校验）；
//   批准门不变声明：本模块只复述清单与流程，不含任何代操作指令，不新增绕过 175 门的路径。
// 零网络零依赖；草稿仅供人本地 diff review，review 通过前不入库；示例全虚构。
import { SCHEMA } from "./job-capture.mjs";

// 固定清单项正文（生成器强制插入；required 标记行由 requiredGateLine 承载）
export const REQUIRED_GATE_TEXT = "任何投递/提交动作前，走 PRD-175 人工批准门";
// required 标记的完整清单行（含 fixed-gate 模板标记，闸门按此识别）
export const REQUIRED_GATE_LINE =
  `- [ ] 【required:true】${REQUIRED_GATE_TEXT} <!-- fixed-gate:prd-175 不可删 -->`;

export class DraftRejected extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// 最小确定性 YAML 标量：JSON 字符串字面量是合法 YAML 双引号标量
const y = (s) => JSON.stringify(s);

// frontmatter → SKILL.md 兼容 YAML 文本（键序固定，输出确定性）
export function renderFrontmatter(fm) {
  return [
    "---",
    `name: ${y(fm.name)}`,
    `description: ${y(fm.description)}`,
    "triggers:",
    "  canonical:",
    ...fm.triggers.canonical.map((t) => `    - ${y(t)}`),
    "  colloquial: []",
    "review:",
    `  state: ${fm.review.state}`,
    `  reviewer: ${y(fm.review.reviewer)}`,
    `  decided_at: ${y(fm.review.decided_at)}`,
    `source: ${fm.source}`,
    "---",
  ].join("\n");
}

// 整份 SKILL.md 兼容草稿渲染（frontmatter + 正文）
export function renderSkillMd(draft) {
  return `${renderFrontmatter(draft.frontmatter)}\n\n${draft.bodyMarkdown}`;
}

// 时间线 → 技能草稿。空步骤/缺 name/description/非 job-capture-v1 一律拒绝。
export function draftFromCapture(capture, { name, description } = {}) {
  if (!capture || capture.schema !== SCHEMA) {
    throw new DraftRejected(`capture 必须是 ${SCHEMA} 时间线`);
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new DraftRejected("name 必填（技能名）");
  }
  if (typeof description !== "string" || !description.trim()) {
    throw new DraftRejected("description 必填（适用场景一句话）");
  }
  if (!Array.isArray(capture.steps) || capture.steps.length === 0) {
    throw new DraftRejected("空步骤时间线不能生成技能草稿（清单无内容可提炼）");
  }

  const frontmatter = {
    name,
    description,
    triggers: { canonical: [`job-skill:${capture.task_kind}`], colloquial: [] },
    review: { state: "draft", reviewer: "", decided_at: "" },
    source: "recorded",
  };

  const stepLines = capture.steps.map((s) => {
    const what = `- [ ] 步骤 ${s.seq}（${s.surface_kind}）：${s.action}`;
    const why = `  - 为什么：${s.intent || "（未记录意图）"}`;
    const note = s.pi_involved
      ? "\n  - 注意：该步涉及个人信息（PII）——录制只记布尔标记，值不入模型，技能同样不含值"
      : "";
    return `${what}\n${why}${note}`;
  });

  const bodyMarkdown = [
    `# ${name}`,
    "",
    `> 草稿（source: recorded）：由录制时间线提炼，review 状态见 frontmatter；`,
    `> 人本地 diff review 通过前不入库。技能只含流程与清单复述，不含代操作指令。`,
    "",
    "## 适用场景",
    "",
    description,
    "",
    "## 步骤清单（每步：做什么 + 为什么 + 注意什么）",
    "",
    ...stepLines,
    "",
    "## 投递前置检查项",
    "",
    REQUIRED_GATE_LINE,
    "",
  ].join("\n");

  return { frontmatter, bodyMarkdown, requiredGateLine: REQUIRED_GATE_LINE };
}

// 闸门校验演示：required 固定清单项不可删——无论正文里有没有该行，删除请求一律拒绝。
// 返回 false = 未删除（闸门据此拒绝缺固定项的草稿）。
export function removeGateLine(body) {
  if (typeof body === "string" && body.includes(REQUIRED_GATE_LINE)) {
    return false; // 命中固定项：required:true，生成器与闸门双重校验，拒绝删除
  }
  return false; // 本就缺固定项的正文：闸门校验同样失败，更谈不上删除成功
}
