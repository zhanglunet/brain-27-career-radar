// PRD-281/T4（trend issue #1409）：投递路径断言——175 门不变。
//
// 按 PRD-281/T1 设计（docs/plans/2026-10-29-prd-281-profile-draft-rollback.md）
// 与 PRD-260 同一手法实现 T4 范围：对本条代码（lib/profile-draft.mjs +
// lib/profile-confirm-flow.mjs）做静态投递执行依赖扫描——
//   assertNoApplyDeps(moduleSources)：模块源码中出现任一投递形态
//     （submitApplication / autoApply / auto_apply / applyToJob / deliverResume /
//     直投端点 URL 字面量，第六形态承自 PRD-260 手法）即抛 ApplyPathDetected
//     （附命中形态与命中片段，可审计）；干净则返回 {ok:true, modules, patterns}。
//   assertGateReferencePresent(moduleSources)：每个模块源码必须含 175 门
//     设计红线行（REQUIRED_GATE_REFERENCE「投递动作仍走 PRD-175 批准门」，
//     T2/T3 模块红线注释所写）——缺失即抛 GateReferenceMissing；在场则原样
//     返回该行（可链式断言）。
//
// 定位（诚实标注，与 PRD-260/T4 相同）：本断言是**绊线**（tripwire），不是
// 穷尽式安全证明——静态扫描可被改写绕过；真正的红线由 PRD-175 批准门在人侧
// 强制。断言的作用是把「含投递执行依赖的模块」在 review/入库/加载时挡下来
// 并留痕。注释里出现形态词同样算命中（保守绊线）。
// 零依赖、零网络、零 IO（读模块源码是测试的职责，本模块只收字符串）；
// 示例全虚构。

// 投递执行依赖静态形态表（六形态，命中任一即拦）
export const APPLY_PATH_PATTERNS = [
  { re: /\bsubmitApplication\b/, why: "submitApplication 直投调用形态" },
  { re: /\bautoApply\b/, why: "autoApply 自动投递调用形态" },
  { re: /\bauto_apply\b/, why: "auto_apply 自动投递调用形态" },
  { re: /\bapplyToJob\b/, why: "applyToJob 直投调用形态" },
  { re: /\bdeliverResume\b/, why: "deliverResume 直投调用形态" },
  // 第六形态（承 PRD-260 手法）：直投端点 URL 字面量（/apply 类端点）
  { re: /["'`]https?:\/\/[^"'`\s]*\/(apply|applications?\/create)\b/i,
    why: "直投端点 URL 字面量（/apply 类）" },
];

// 175 门设计红线行：T2/T3 模块（profile-draft.mjs / profile-confirm-flow.mjs）
// 红线注释里逐字写明的这句话；模块源码缺此行 = 设计红线丢失，断言拦截。
export const REQUIRED_GATE_REFERENCE = "投递动作仍走 PRD-175 批准门";

export class ApplyPathDetected extends Error {
  /**
   * @param {Array<{why:string, sample:string}>} matches 命中形态列表
   * @param {string[]} [moduleNames] 命中所在模块名（多源断言时定位用）
   */
  constructor(matches, moduleNames = []) {
    const where = moduleNames.length > 0 ? `（模块：${moduleNames.join("、")}）` : "";
    super(`检出投递执行依赖形态（红线：投递动作仍走 PRD-175 批准门，本条代码不得自带投递路径）${where}：${matches.map((m) => m.why).join("；")}`);
    this.name = "ApplyPathDetected";
    this.matches = matches;
    this.moduleNames = moduleNames;
  }
}

export class GateReferenceMissing extends Error {
  constructor(moduleNames = []) {
    const where = moduleNames.length > 0 ? `（模块：${moduleNames.join("、")}）` : "";
    super(`175 门设计红线行缺失（「${REQUIRED_GATE_REFERENCE}」必须在模块源码声明）${where}`);
    this.name = "GateReferenceMissing";
    this.moduleNames = moduleNames;
  }
}

/** 单源扫描：返回命中形态 [{why, sample}]（空数组 = 干净）。 */
export function scanApplyDeps(moduleSource) {
  if (typeof moduleSource !== "string") {
    throw new TypeError("moduleSource 必须为字符串（模块源码文本）");
  }
  return APPLY_PATH_PATTERNS
    .filter(({ re }) => re.test(moduleSource))
    .map(({ re, why }) => ({ why, sample: (moduleSource.match(re) || [""])[0].slice(0, 80) }));
}

/** 归一化输入：string | string[] | {name, source}[] → [{name, source}]。 */
function normalizeSources(moduleSources) {
  if (typeof moduleSources === "string") {
    return [{ name: "<module-source>", source: moduleSources }];
  }
  if (!Array.isArray(moduleSources)) {
    throw new TypeError("moduleSources 必须为字符串、字符串数组或 {name, source} 数组");
  }
  return moduleSources.map((item, i) => {
    if (typeof item === "string") return { name: `module#${i}`, source: item };
    if (item && typeof item === "object" && typeof item.source === "string") {
      return { name: item.name ?? `module#${i}`, source: item.source };
    }
    throw new TypeError(`moduleSources[${i}] 非字符串源码（{name, source}）`);
  });
}

/**
 * 静态断言：给定模块源码全部不含投递执行依赖形态（import 图无投递执行依赖）。
 * 干净 → 返回 {ok:true, modules:n, patterns:6}；
 * 命中 → 抛 ApplyPathDetected（含全部命中形态 + 所在模块名，供 review 留痕）。
 * @param {string|Array<string|{name:string,source:string}>} moduleSources
 */
export function assertNoApplyDeps(moduleSources) {
  const sources = normalizeSources(moduleSources);
  const hits = [];
  for (const { name, source } of sources) {
    for (const match of scanApplyDeps(source)) {
      hits.push({ ...match, module: name });
    }
  }
  if (hits.length > 0) {
    throw new ApplyPathDetected(
      hits.map(({ why, sample }) => ({ why, sample })),
      [...new Set(hits.map((h) => h.module))],
    );
  }
  return { ok: true, modules: sources.length, patterns: APPLY_PATH_PATTERNS.length };
}

/**
 * 断言：每个模块源码都含 175 门设计红线行（REQUIRED_GATE_REFERENCE）。
 * 非字符串源码 → TypeError（用法错）；任一模块缺该行 → GateReferenceMissing
 * （指明缺失模块）；全部在场 → 原样返回该行（可链式断言）。
 */
export function assertGateReferencePresent(moduleSources) {
  const sources = normalizeSources(moduleSources);
  const missing = sources.filter(({ source }) => !source.includes(REQUIRED_GATE_REFERENCE));
  if (missing.length > 0) {
    throw new GateReferenceMissing(missing.map(({ name }) => name));
  }
  return REQUIRED_GATE_REFERENCE;
}
