/**
 * PRD-150/T2 · 简历模板（单栏 A4，T1 §2.2）。
 *
 * 声明式块由本函数按档案条目枚举生成；排版与空槽规则由 render.ts 解释：
 * - 联系行空槽连同 `·` 分隔符消失；
 * - `outputs` 整块为空则连区块标题一起省略；
 * - 单个必选字段缺失留 `[待填写：字段路径]`；
 * - 研究经历按 experience[] 逆序（最新在前）。
 */

import type { JobDocProfile, JobDocOutput } from "../profile.ts";
import type { TemplateSpec, TemplateBlock } from "./types.ts";

/** 成果条目是否有任何可展示字段（全空条目不产生行）。 */
function hasAnyField(output: JobDocOutput): boolean {
  return (
    output.title !== undefined ||
    output.venue !== undefined ||
    output.year !== undefined ||
    output.url !== undefined
  );
}

/** 按档案生成 resume 模板块列表。 */
export function resumeBlocks(profile: JobDocProfile): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];

  blocks.push({ type: "heading", slot: "basics.name" });
  blocks.push({
    type: "contact",
    slots: ["basics.email", "basics.phone", "basics.location", "basics.homepage"],
    separator: " · ",
  });
  blocks.push({ type: "rule" });

  // ── 教育背景 ──
  blocks.push({ type: "section", label: "教育背景" });
  const education = profile.education ?? [];
  if (education.length === 0) {
    blocks.push({ type: "line", parts: [{ slot: "education", required: true }] });
  } else {
    education.forEach((_, i) => {
      blocks.push({
        type: "line",
        parts: [
          { slot: `education[${i}].school` },
          { slot: `education[${i}].period`, prefix: "  " },
        ],
      });
      blocks.push({
        type: "line",
        parts: [
          { slot: `education[${i}].degree`, required: true },
          { slot: `education[${i}].note`, prefix: "；" },
        ],
      });
    });
  }

  // ── 研究经历（逆序：最新在前）──
  blocks.push({ type: "section", label: "研究经历" });
  const experience = profile.experience ?? [];
  if (experience.length === 0) {
    blocks.push({ type: "line", parts: [{ slot: "experience", required: true }] });
  } else {
    for (let i = experience.length - 1; i >= 0; i -= 1) {
      blocks.push({
        type: "line",
        hanging: true,
        parts: [
          { slot: `experience[${i}].title`, required: true },
          { slot: `experience[${i}].org`, prefix: " @ " },
          { slot: `experience[${i}].period`, prefix: "  " },
        ],
      });
      blocks.push({
        type: "line",
        hanging: true,
        parts: [{ slot: `experience[${i}].highlight`, required: true }],
      });
    }
  }

  // ── 技能（顿号连接，解析层拼接）──
  blocks.push({ type: "section", label: "技能" });
  blocks.push({ type: "line", parts: [{ slot: "skills", required: true }] });

  // ── 成果（整块为空则省略，含区块标题；T1 §2.2）──
  // 注意：插槽路径用原始数组下标（全空条目跳过但索引不重排，
  // 渲染层按同一数组解析 outputs[i] → `title · venue · year · url`）。
  const outputs = profile.outputs ?? [];
  const renderable = outputs.filter(hasAnyField);
  if (renderable.length > 0) {
    blocks.push({ type: "section", label: "成果" });
    outputs.forEach((output, i) => {
      if (hasAnyField(output)) {
        blocks.push({ type: "line", parts: [{ slot: `outputs[${i}]` }] });
      }
    });
  }

  return blocks;
}

/** resume 模板规格（产物 kind = cv，对齐现有 DraftKind）。 */
export function resumeTemplate(profile: JobDocProfile): TemplateSpec {
  return {
    id: "resume",
    kind: "cv",
    title: "中文简历（单页优先）",
    blocks: resumeBlocks(profile),
  };
}
