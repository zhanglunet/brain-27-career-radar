// PRD-260/T4（trend #1303）：投递路径断言——静态扫描，投递仍强制走 PRD-175 批准门。
//
// 按 PRD-260/T1 设计（docs/plans/2026-10-28-prd-260-job-skills-recorder.md）实现 T4 范围：
//   assertNoApplyPath(moduleSource)：对模块源码做静态拒绝扫描——出现
//     submitApplication / autoApply / auto_apply / 直接投递 API 调用形态
//     （POST 到 /apply 类端点、application 对象直投方法）任一即抛
//     ApplyPathDetected（附命中形态与理由，可审计）；
//   assertGateLinePresent(draftBody)：PRD-175 固定批准门清单行
//     （REQUIRED_GATE_LINE，T3 生成器强制插入）缺失即抛 GateLineMissing；
//     在场则原样返回该行（可链式断言）。
// 定位（诚实标注）：本断言是**绊线**（tripwire），不是穷尽式安全证明——静态拒绝
// 扫描可被改写绕过；真正的红线由 PRD-175 批准门在人侧强制。断言的作用是把
// 「含直投路径的模块」在 review/入库/加载时挡下来并留痕。
// 零网络零依赖；示例全虚构。
import { REQUIRED_GATE_LINE } from "./job-skill-draft.mjs";

// 直投路径静态形态表（命中任一即拦；注释里出现同样算——保守绊线）
export const APPLY_PATH_PATTERNS = [
  { re: /\bsubmitApplication\b/, why: "submitApplication 直投调用形态" },
  { re: /\bautoApply\b/, why: "autoApply 自动投递调用形态" },
  { re: /\bauto_apply\b/, why: "auto_apply 自动投递调用形态" },
  // application 对象直投方法：application.submit(...) / jobApplication.create(...) 等
  { re: /\b[a-z]*application[a-z]*\.(submit|create|send|post)\s*\(/i,
    why: "application 对象直投方法调用形态" },
  // 直接投递 API 调用形态：对 /apply 类端点发 POST（fetch 形态或 URL 字面量）
  { re: /["'`]https?:\/\/[^"'`\s]*\/(apply|applications?\/create)\b/i,
    why: "直投端点 URL 字面量（/apply 类）" },
  { re: /method\s*:\s*["'`]POST["'`][^)}]{0,160}?\bapply\b|\bapply\b[^)}]{0,160}?method\s*:\s*["'`]POST["'`]/i,
    why: "POST 到 /apply 类端点的调用形态" },
];

export class ApplyPathDetected extends Error {
  constructor(matches) {
    super(`检出投递路径形态（红线：投递必须走 PRD-175 人工批准门）：${matches.map((m) => m.why).join("；")}`);
    this.name = "ApplyPathDetected";
    this.matches = matches;
  }
}

export class GateLineMissing extends Error {
  constructor() {
    super("PRD-175 批准门固定清单行缺失（required:true 不可删）——草稿不合规");
    this.name = "GateLineMissing";
  }
}

function scanApplyPath(moduleSource) {
  if (typeof moduleSource !== "string") {
    throw new TypeError("moduleSource 必须为字符串（模块源码文本）");
  }
  return APPLY_PATH_PATTERNS
    .filter(({ re }) => re.test(moduleSource))
    .map(({ re, why }) => ({ why, sample: (moduleSource.match(re) || [""])[0].slice(0, 80) }));
}

// 静态断言：模块源码不含任何直投路径形态。干净 → 返回 {ok:true, patterns:n}；
// 命中 → 抛 ApplyPathDetected（含全部命中形态，供 review 留痕）。
export function assertNoApplyPath(moduleSource) {
  const matches = scanApplyPath(moduleSource);
  if (matches.length > 0) throw new ApplyPathDetected(matches);
  return { ok: true, patterns: APPLY_PATH_PATTERNS.length };
}

// 断言：草稿正文含 PRD-175 批准门固定清单行（T3 生成器强制插入的那行）。
// 非字符串 → TypeError（用法错）；缺失 → 抛 GateLineMissing；在场 → 原样返回该行。
export function assertGateLinePresent(draftBody) {
  if (typeof draftBody !== "string") {
    throw new TypeError("draftBody 必须为字符串（草稿正文 Markdown）");
  }
  if (!draftBody.includes(REQUIRED_GATE_LINE)) {
    throw new GateLineMissing();
  }
  return REQUIRED_GATE_LINE;
}
