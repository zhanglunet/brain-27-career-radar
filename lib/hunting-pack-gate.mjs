// PRD-577/T3（trend issue #2897 的 T3 环节）：brain-27-career-radar 巡检校验闸门。
//
// 按 T1 设计（docs/plans/2026-11-20-prd-577-brain-hunting-design.md）§5 落地：
//   - appendOnlyGate：FINDING 留痕只增不删复核（FINDING_LEDGER_DRIFT）；
//   - checkReproEvidence：复现证据可验证（REPRO_MISSING）；
//   - checkFpVeto：误报复核一票否决（FP_ADMIT）；
//   - checkHuntVocab：巡检结论词表封闭（HUNT_VOCAB_GAP）；
//   - gateSummary：多闸一票否决。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/hunting-pack-gate.test.mjs
export const GATE_SCHEMA = 'brain-hunt-gate/v1';
export const ERROR_CODES = ['FINDING_LEDGER_DRIFT', 'REPRO_MISSING',
                            'FP_ADMIT', 'HUNT_VOCAB_GAP'];
export const FINDING_REQUIRED = ['finding', 'repro', 'evidence', 'found_at'];
export const HUNT_CONCLUSIONS = ['有发现', '无可复现发现'];

const fail = (code, detail) => ({ schema: GATE_SCHEMA, gate: 'block',
                                  reasons: [{ code, detail }] });
const pass = () => ({ schema: GATE_SCHEMA, gate: 'pass', reasons: [] });

export function appendOnlyGate(entries, baselineFirst, baselineLen) {
  /** FINDING 留痕只增不删复核。 */
  if (entries.length < baselineLen) {
    return fail('FINDING_LEDGER_DRIFT',
      '账目长度 ' + entries.length + ' < 基线 ' + baselineLen + '——发生删除');
  }
  if (baselineFirst !== null && entries.length
      && JSON.stringify(entries[0]) !== JSON.stringify(baselineFirst)) {
    return fail('FINDING_LEDGER_DRIFT', '首条留痕被改写');
  }
  return pass();
}

export function checkReproEvidence(entries) {
  /** 复现证据可验证：无「复现」repro 或空证据 → REPRO_MISSING。 */
  for (const e of entries) {
    if (e.repro !== '复现' || !String(e.evidence || '').trim()) {
      return fail('REPRO_MISSING',
        'finding 无复现证据：' + JSON.stringify(e.finding || ''));
    }
  }
  return pass();
}

export function checkFpVeto(entries) {
  /** 误报复核一票否决：review=「误报」的条目仍在集合里 → FP_ADMIT。 */
  const fps = entries.filter((e) => e.review === '误报');
  if (fps.length) {
    return fail('FP_ADMIT',
      fps.length + ' 条误报未摘除——复核后先摘除再进收件箱');
  }
  return pass();
}

export function checkHuntVocab(hunt) {
  /** 巡检结论词表封闭。 */
  if (!HUNT_CONCLUSIONS.includes(hunt)) {
    return fail('HUNT_VOCAB_GAP', '巡检结论词表外：' + JSON.stringify(hunt));
  }
  return pass();
}

export function gateSummary(checks) {
  /** 多闸一票否决。 */
  const reasons = checks.flatMap((c) => c.reasons || []);
  return { schema: GATE_SCHEMA, gate: reasons.length ? 'block' : 'pass',
           gates_checked: checks.length, reasons };
}
