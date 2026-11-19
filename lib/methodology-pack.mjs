// PRD-531/T2（trend issue #2574 的 T2 环节）：brain-27-career-radar 求职方法论包 方法论包最小实现。
//
// 按 T1 设计（docs/plans/2026-11-19-prd-531-brain-methodology-design.md）§1/§3 落地：方法论包四件套落账——
//   - WORKFLOW_STEPS：5 步标准做法（封闭词表，跳步/乱步/多步
//     在 checkStepSequence 拦下）；
//   - SKILLSET_NAME：机会 skill 集（收口本仓既有技能，不新增形态）；
//   - METHOD_COMMAND：`/apply` 命令入口；
//   - PatternLedger：模式库 JSONL append-only（路径注入），条目必带
//     pattern / source_case / evidence / caliber_version 四件，缺一拒绝
//     入账。
//   - renderPackMd：方法论包 Markdown 渲染（两遍逐字节一致）。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/methodology-pack.test.mjs
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const METHODOLOGY_SCHEMA = 'brain-methodology/v1';
export const METHOD_DOMAIN = 'brain-27-career-radar 求职方法论包';
export const METHOD_COMMAND = '/apply';
export const WORKFLOW_STEPS = ["看机会", "评估", "准备", "投递", "跟进"];
export const SKILLSET_NAME = '机会 skill 集';
export const PATTERN_REQUIRED = ['pattern', 'source_case', 'evidence',
                                 'caliber_version'];

export class MethodologyError extends Error {}

export function checkStepSequence(steps) {
  /** workflow 步骤序列校验：实际执行序列必须是 workflow 的严格前缀
   * （进行中合法）或全序列（完成）；跳步/乱步/多步 → STEP_INVALID。 */
  if (!Array.isArray(steps) || steps.some((s) => typeof s !== 'string'
                                          || !s)) {
    return { ok: false, reason: 'STEP_INVALID',
             detail: '步骤序列非字符串列表' };
  }
  if (steps.length > WORKFLOW_STEPS.length) {
    return { ok: false, reason: 'STEP_INVALID',
             detail: `步骤数 ${steps.length} 超出 workflow `
               + `${WORKFLOW_STEPS.length} 步（多步）` };
  }
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== WORKFLOW_STEPS[i]) {
      return { ok: false, reason: 'STEP_INVALID',
               detail: `第 ${i + 1} 步应为 ${WORKFLOW_STEPS[i]}，`
                 + `实际 ${steps[i]}（乱步/跳步）` };
    }
  }
  return { ok: true, reason: 'ok',
           detail: steps.length === WORKFLOW_STEPS.length ? '完成' : '进行中' };
}

export class PatternLedger {
  /** 模式库账本：JSONL append-only（路径注入），条目四件缺一拒绝入账。 */
  constructor(path = null) {
    this._records = [];
    this._path = path;
  }

  record(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new MethodologyError('PATTERN_INVALID：条目非对象');
    }
    const missing = PATTERN_REQUIRED.filter((k) => typeof entry[k] !== 'string'
                                              || !entry[k].trim());
    if (missing.length) {
      throw new MethodologyError('PATTERN_INCOMPLETE：模式条目缺 '
        + JSON.stringify(missing)
        + '——每条必须带 pattern/source_case/evidence/caliber_version');
    }
    const rec = { schema: METHODOLOGY_SCHEMA,
                  ...JSON.parse(JSON.stringify(entry)) };
    this._records.push(JSON.parse(JSON.stringify(rec)));
    if (this._path !== null) {
      mkdirSync(dirname(this._path), { recursive: true });
      appendFileSync(this._path, JSON.stringify(rec) + '\n', 'utf8');
    }
    return { ...rec };
  }

  entries() {
    return this._records.map((e) => JSON.parse(JSON.stringify(e)));
  }
}

export function renderPackMd() {
  /** 方法论包 Markdown 渲染（四件套全展示；两遍逐字节一致）。 */
  const lines = [
    `# ${METHOD_DOMAIN}方法论包（${METHODOLOGY_SCHEMA}）`,
    '',
    '- 命令入口：`' + METHOD_COMMAND + '`（按 workflow 顺序驱动）',
    `- skill 集：${SKILLSET_NAME}（收口本仓既有技能，不新增形态）`,
    '',
    '## workflow（5 步标准做法）',
    '',
    '| # | 步骤 | 完成判据 |',
    '|---|---|---|',
  ];
  WORKFLOW_STEPS.forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s} | ${s}判据可验证（字段见包校验） |`);
  });
  lines.push(
    '',
    '## 模式库',
    '',
    '- JSONL append-only（docs/methodology/ 下）',
    '- 条目四件：pattern / source_case / evidence / caliber_version',
    '',
    '## 红线',
    '',
    '- 无方法论包的技能不成套、不进上游审批（T3 校验拦截）。',
    '- 方法论包不代行审批；模式库只追加、不改历史条目。',
    '',
  );
  return lines.join('\n');
}

// PRD-531 修复：T5 验收测试（tests/test_prd531_t5_acceptance.test.mjs）从 pack 模块直接导入闸门函数——re-export 对齐。
export { checkPack, checkPatternEntry, checkWorkflow } from './methodology-pack-gate.mjs';
