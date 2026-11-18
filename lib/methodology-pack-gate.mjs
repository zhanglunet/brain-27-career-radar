// PRD-531/T3（trend issue #2575 的 T3 环节）：brain-27-career-radar 求职方法论包 方法论包校验闸门。
//
// 按 T1 设计（docs/plans/2026-11-19-prd-531-brain-methodology-design.md）§3/§5 落地：
//   - checkPack(hasPack)：无方法论包的技能进上游审批 → PACK_MISSING；
//   - checkPatternEntry(entry)：四件缺一 → PATTERN_INCOMPLETE；
//   - checkWorkflow(steps)：跳步/乱步/多步 → STEP_INVALID（绑定 T2）；
//   - gateSummary：多闸一票否决。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/methodology-pack-gate.test.mjs
import { PATTERN_REQUIRED, WORKFLOW_STEPS, checkStepSequence }
  from './methodology-pack.mjs';

export const GATE_SCHEMA = 'brain-methodology-gate/v1';
export const GATE_PRD = 531;
export const GATE_REPO = 'brain-27-career-radar';
export const ERROR_CODES = ['PACK_MISSING', 'PATTERN_INCOMPLETE',
                            'STEP_INVALID'];

const reason = (code, target, detail) => ({ code, target, detail });

export function checkPack(hasPack, skillId = '') {
  if (!hasPack) {
    return { allowed: false, gate: 'blocked',
             reasons: [reason('PACK_MISSING', skillId || 'unknown',
               '无方法论包——技能不成套，不进上游审批')] };
  }
  return { allowed: true, reasons: [], gate: 'passed' };
}

export function enforcePack(hasPack, skillId = '') {
  const d = checkPack(hasPack, skillId);
  if (!d.allowed) {
    throw new Error(`GATE_BLOCKED：${d.reasons[0].detail}`);
  }
  return d;
}

export function checkPatternEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { allowed: false, gate: 'blocked',
             reasons: [reason('PATTERN_INCOMPLETE', null, '条目非对象')] };
  }
  const missing = PATTERN_REQUIRED.filter((k) => typeof entry[k] !== 'string'
                                            || !entry[k].trim());
  if (missing.length) {
    return { allowed: false, gate: 'blocked',
             reasons: [reason('PATTERN_INCOMPLETE',
               entry.pattern || 'unknown',
               `模式条目缺 ${JSON.stringify(missing)}`)] };
  }
  return { allowed: true, reasons: [], gate: 'passed' };
}

export function checkWorkflow(steps) {
  const d = checkStepSequence(steps);
  if (!d.ok) {
    return { allowed: false, gate: 'blocked',
             reasons: [reason('STEP_INVALID', null, d.detail)] };
  }
  return { allowed: true, reasons: [], gate: 'passed' };
}

export function gateSummary(checks) {
  const reasons = checks.flatMap((c) => c.reasons || []);
  return { schema: GATE_SCHEMA, gate: reasons.length ? 'block' : 'pass',
           gates_checked: checks.length, reasons };
}
