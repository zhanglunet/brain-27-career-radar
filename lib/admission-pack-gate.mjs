// PRD-554/T3（trend issue #2690 的 T3 环节）：brain-27-career-radar 准入检查校验闸门。
//
// 按 T1 设计（docs/plans/2026-11-20-prd-554-brain-admission-design.md）§5 落地：
//   - appendOnlyGate：留痕 JSONL 只增不删复核，破坏 ADMISSION_LEDGER_DRIFT 显形；
//   - checkLayerCoverage：五层覆盖校验（缺层/层词表外 LAYER_COVERAGE_GAP 拦下）；
//   - checkOneVote：任一层「不过」而 admission != 「不进（整改）」→ ONE_VOTE_BYPASS；
//   - checkNoAutoAdmit：admission 词表封闭复核（机器不代行准入）；
//   - gateSummary：多闸一票否决。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/2690
export const GATE_SCHEMA = 'brain-admission-gate/v1';
export const ERROR_CODES = ['ADMISSION_LEDGER_DRIFT', 'LAYER_COVERAGE_GAP',
                            'ONE_VOTE_BYPASS', 'AUTO_ADMIT'];
export const LAYERS = ['L1_quality', 'L2_security', 'L3_overlap',
                       'L4_synth', 'L5_live'];
export const REQUIRED_ENTRY_KEYS = ['layer', 'verdict', 'evidence',
                                    'checked_at'];

const fail = (code, detail) => ({ schema: GATE_SCHEMA, gate: 'block',
                                  reasons: [{ code, detail }] });
const pass = () => ({ schema: GATE_SCHEMA, gate: 'pass', reasons: [] });

export function appendOnlyGate(entries, baselineFirst, baselineLen) {
  /** 准入留痕只增不删复核。 */
  if (entries.length < baselineLen) {
    return fail('ADMISSION_LEDGER_DRIFT',
      '账目长度 ' + entries.length + ' < 基线 ' + baselineLen + '——发生删除');
  }
  if (baselineFirst !== null && entries.length
      && JSON.stringify(entries[0]) !== JSON.stringify(baselineFirst)) {
    return fail('ADMISSION_LEDGER_DRIFT', '首条留痕被改写');
  }
  return pass();
}

export function checkLayerCoverage(entries) {
  /** 五层覆盖校验：缺层/层词表外 → LAYER_COVERAGE_GAP。 */
  const seen = new Set();
  for (const e of entries) {
    const layer = e.layer || '';
    if (!LAYERS.includes(layer)) {
      return fail('LAYER_COVERAGE_GAP', '层词表外：' + layer);
    }
    seen.add(layer);
  }
  const missing = LAYERS.filter((l) => !seen.has(l));
  if (missing.length) {
    return fail('LAYER_COVERAGE_GAP', '缺层：' + JSON.stringify(missing));
  }
  return pass();
}

export function checkOneVote(entries, admission) {
  /** 一票否决不可绕：任一层「不过」而 admission 不是「不进（整改）」。 */
  const hasBlock = entries.some((e) => e.verdict === '不过');
  if (hasBlock && admission !== '不进（整改）') {
    return fail('ONE_VOTE_BYPASS',
      '存在「不过」层但 admission=' + JSON.stringify(admission) + '——一票否决被绕');
  }
  return pass();
}

export function checkNoAutoAdmit(admission) {
  /** 机器不代行准入：admission 词表封闭（确认动作由收件箱环节执行）。 */
  if (!['可进收件箱', '不进（整改）', '待复核', '待补测'].includes(admission)) {
    return fail('AUTO_ADMIT', 'admission 词表外：' + JSON.stringify(admission));
  }
  return pass();
}

export function gateSummary(checks) {
  /** 多闸一票否决。 */
  const reasons = checks.flatMap((c) => c.reasons || []);
  return { schema: GATE_SCHEMA, gate: reasons.length ? 'block' : 'pass',
           gates_checked: checks.length, reasons };
}
