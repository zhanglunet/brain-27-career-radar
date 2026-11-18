// PRD-484/T3（trend issue #2342 的 T3 环节）：机会技能评估 监督回路闸门。
//
// 按 T1 设计（docs/plans/2026-11-17-prd-484-brain-skill-evaluation-design.md）落地：把"评估未过关的技能不得进入投递批准门"
// 做成强制检查。T2 只产出评估报告——质量门结论、疑似重叠、整改候选都写在
// 报告里，但没有任何东西拦住未过关技能的产物进投递批准门。
//
// T3 的做法（只加检查，不改 T2 的评估逻辑与报告格式，按技能过闸）：
//   - checkGate(report, skillId)：纯函数，不改报告；以 T2 报告的 verdicts
//     为准重新推导"该技能是否可进投递批准门"——结论是"通过" + 不在疑似重叠
//     对里，两项缺一不可；只认"技能在清单里"或只认"曾经通过"的一律拦下，
//     并逐条给出拦截原因（code + target + detail）。
//   - enforceGate：不通过即显形拒绝（GateError，GATE_BLOCKED）。
//   - admitToDownstream：投递批准门唯一允许的入口——先过闸，再把放行/拦截的
//     审计条目写进 SkillEvaluationLedger（拦截也留痕，绕关尝试有据可查）；
//     结论为"整改"而被拦的技能，另追加一条整改条目（append-only，原因/证据/
//     整改期限/复测结果齐全，期限待人填、不编造）。
//   - gateOutlet：加固版批量出口，逐技能过闸；未知/残缺技能按拦截处理，
//     永不抛错漏放。
//   - 整改清单 append-only：SkillEvaluationLedger 只追加、不改历史条目；
//     formatRemediationLine 把整改条目渲染成 remediation-log 的行格式。
//
// 口径（按 T1 设计"机会技能包定期体检，坏技能进清单修，投递批准门只审评估过关的技能捞到的机会。"）：
//   - "通过"才放行；"整改"拦下并进整改清单；"证据不足"也拦下——证据不足
//     不是失效，不进整改清单，只等对照跑分补测；疑似重叠拦下待人确认
//     （行为层确认与合并/拆分/保留分工由人决定）。报告缺 suspected 列表按
//     BAD_REPORT 拦下——缺重叠结果不得放行。
//   - 报告没有逐技能版本字段（清单里技能只有 id，没有 version），闸门暂按
//     结论裁决，并在审计里记报告日期与清单版本；清单补版本字段后可收紧。
//
// 本模块不重跑评估、不改报告、不改清单、不碰技能包——只有检查与审计，没有
// 放行的后门；评估结论的改动仍走 T2 的评估流程；发布仍人工确认。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/skill-evaluation-gate.test.mjs
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GATE_SCHEMA = 'skill-evaluation-gate/v1';
export const GATE_PRD = 484;
export const GATE_REPO = 'brain-27-career-radar';
export const BLOCK_REASON_CODES = ['BAD_REPORT', 'UNKNOWN_SKILL', 'REMEDIATE',
                                   'INSUFFICIENT_EVIDENCE',
                                   'SUSPECTED_OVERLAP'];
export const GATE_AUDIT_KINDS = ['gate_passed', 'gate_blocked', 'remediation'];

export class GateError extends Error {}

const now = (at) => at || '1970-01-01T00:00:00Z';

const reason = (code, target, detail) => ({ code, target, detail });

function verdictFor(report, skillId) {
  for (const v of (report?.verdicts || [])) {
    if (v && typeof v === 'object' && v.id === skillId) return v;
  }
  return null;
}

function suspectedSkills(report) {
  const found = new Set();
  for (const p of (report?.suspected || [])) {
    if (!p || typeof p !== 'object' || !p.suspected) continue;
    for (const key of ['a', 'b']) {
      if (typeof p[key] === 'string' && p[key]) found.add(p[key]);
    }
  }
  return found;
}

export function checkGate(report, skillId) {
  /** 强制复核：以 T2 报告为准重新推导"该技能是否可进投递批准门"。
   * 返回 { allowed, reasons }；报告残缺时只拦下不抛错；
   * 技能不在报告里则显形拒绝（UNKNOWN_SKILL）。
   */
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { allowed: false,
             reasons: [reason('BAD_REPORT', null, '评估报告不是 object')] };
  }
  if (report.prd !== GATE_PRD || report.repo !== GATE_REPO) {
    return { allowed: false,
             reasons: [reason('BAD_REPORT', report.prd,
               `评估报告非 PRD-${GATE_PRD}（${GATE_REPO}）`)] };
  }
  if (!Array.isArray(report.verdicts)) {
    return { allowed: false,
             reasons: [reason('BAD_REPORT', skillId, '报告无 verdicts 列表')] };
  }
  if (!Array.isArray(report.suspected)) {
    return { allowed: false,
             reasons: [reason('BAD_REPORT', skillId,
               '报告无 suspected 列表——缺重叠结果不得放行')] };
  }
  const verdict = verdictFor(report, skillId);
  if (verdict === null) {
    throw new GateError(`UNKNOWN_SKILL：报告里无此技能 skillId=${JSON.stringify(skillId)}`);
  }
  const reasons = [];
  const conclusion = verdict.verdict;
  if (conclusion === '整改') {
    reasons.push(reason('REMEDIATE', skillId,
      `技能 ${JSON.stringify(skillId)} 质量门未过关：${verdict.reason}`));
  } else if (conclusion === '证据不足') {
    reasons.push(reason('INSUFFICIENT_EVIDENCE', skillId,
      `技能 ${JSON.stringify(skillId)} 证据不足，未过关：${verdict.reason}`));
  } else if (conclusion !== '通过') {
    reasons.push(reason('BAD_REPORT', skillId,
      `技能 ${JSON.stringify(skillId)} 结论词表外 verdict=${JSON.stringify(conclusion)}`));
  }
  if (suspectedSkills(report).has(skillId)) {
    reasons.push(reason('SUSPECTED_OVERLAP', skillId,
      `技能 ${JSON.stringify(skillId)} 在疑似重叠对里，待人确认（不自动合并）`));
  }
  return { allowed: reasons.length === 0, reasons };
}

export function enforceGate(report, skillId) {
  /** 过闸：不通过即显形拒绝；通过返回 checkGate 的裁决。 */
  const verdict = checkGate(report, skillId);
  if (!verdict.allowed) {
    const codes = verdict.reasons
      .map((r) => `${r.code}(${JSON.stringify(r.target)})`).join('; ');
    throw new GateError(`GATE_BLOCKED：评估未过关不进${GATE_REPO}下游——${codes}`);
  }
  return verdict;
}

function recordDecision(ledger, report, skillId, verdict, by, at) {
  /** 记一条闸门审计；结论为"整改"而被拦时，另追加一条整改条目。 */
  const entry = {
    kind: verdict.allowed ? 'gate_passed' : 'gate_blocked',
    skill_id: skillId, by, at: now(at),
    reasons: verdict.reasons.map((r) => r.code),
    targets: verdict.reasons.map((r) => r.target),
  };

  ledger.record(report && typeof report === 'object' ? report : {}, entry);
  if (verdict.allowed) return;
  if (!verdict.reasons.some((r) => r.code === 'REMEDIATE')) return;
  const rem = verdict.reasons.find((r) => r.code === 'REMEDIATE');
  const date = report && typeof report === 'object' ? report.date : null;
  const version = report && typeof report === 'object'
    ? report.inventory_version : null;
  ledger.record(report && typeof report === 'object' ? report : {}, {
    kind: 'remediation', skill_id: skillId, by, at: now(at),
    verdict: '整改', reason: rem.detail,
    evidence: `评估报告 ${date || '未知日期'}，清单 v${version || '未知'}`,
    due: '待定', action: '修', retest: null,
  });
}

export function admitToDownstream(report, skillId, { ledger = null, by, at = '' } = {}) {
  /** 投递批准门唯一允许的入口：先过闸，再把裁决写进账本留痕。
   * 拦截时先记一条 gate_blocked 审计（绕关尝试有据可查），再显形拒绝。
   * 未知技能也先记账再拒绝。ledger 给了就必须给 by（审计须署名）。
   */
  let verdict;
  try {
    verdict = checkGate(report, skillId);
  } catch (exc) {
    verdict = { allowed: false,
               reasons: [reason('UNKNOWN_SKILL', skillId, String(exc))] };
  }
  if (ledger !== null) {
    if (!by) throw new GateError('GATE_BLOCKED：审计留痕须 by（裁决人必填）');
    recordDecision(ledger, report, skillId, verdict, by, at);
  }
  if (!verdict.allowed) {
    const codes = verdict.reasons
      .map((r) => `${r.code}(${JSON.stringify(r.target)})`).join('; ');
    throw new GateError(`GATE_BLOCKED：评估未过关不进${GATE_REPO}下游——${codes}`);
  }
  const record = verdictFor(report, skillId);
  return { admitted: {
    skill_id: skillId,
    verdict: record ? record.verdict : null,
    report_date: report && typeof report === 'object' ? report.date : null,
    inventory_version: report && typeof report === 'object'
      ? report.inventory_version : null,
  }, verdict };
}

export function gateOutlet(report, skillIds, { ledger = null, by, at = '' } = {}) {
  /** 加固版批量出口：逐技能过闸，只放行 checkGate 通过的技能。 */
  const passed = [];
  const blocked = [];
  for (const skillId of (skillIds || [])) {
    let verdict;
    try {
      verdict = checkGate(report, skillId);
    } catch (exc) {
      verdict = { allowed: false,
                 reasons: [reason('UNKNOWN_SKILL', skillId, String(exc))] };
    }
    if (ledger !== null) {
      if (!by) throw new GateError('GATE_BLOCKED：审计留痕须 by（裁决人必填）');
      recordDecision(ledger, report, skillId, verdict, by, at);
    }
    if (verdict.allowed) {
      const record = verdictFor(report, skillId);
      passed.push({
        skill_id: skillId,
        verdict: record ? record.verdict : null,
        report_date: report && typeof report === 'object' ? report.date : null,
        inventory_version: report && typeof report === 'object'
          ? report.inventory_version : null,
      });
    } else {
      const record = verdictFor(report, skillId);
      blocked.push({
        skill_id: skillId,
        verdict: record ? record.verdict : null,
        reasons: verdict.reasons,
      });
    }
  }
  return { schema: GATE_SCHEMA, passed, blocked, blocked_count: blocked.length };
}

export function formatRemediationLine(entry) {
  /** 整改条目 → remediation-log 的行格式（只渲染，不改历史条目）。 */
  const date = String(entry.at || '').slice(0, 10) || '未知日期';
  const retest = entry.retest;
  return `- ${date} 技能 ${entry.skill_id}：${entry.reason} / `
    + `证据（${entry.evidence}）/ 整改期限 ${entry.due} / `
    + `建议动作 ${entry.action} / 复测结果 ${retest || '待复测'}`;
}

export class SkillEvaluationLedger {
  /** 评估闸门留痕账本：JSONL append-only（路径注入），缺件拒绝入账。
   * 三种条目：gate_passed / gate_blocked（闸门审计）、remediation（整改条目）。
   * 只追加、不改历史条目；entries() 返回深拷贝，改返回结果不污染账本。
   */
  constructor(path = null) {
    this._records = [];
    this._path = path;
  }

  record(report, entry) {
    const safeReport = report && typeof report === 'object' ? report : {};
    const rec = { schema: GATE_SCHEMA, prd: safeReport.prd ?? null,
                 report_date: safeReport.date ?? null,
                 ...JSON.parse(JSON.stringify(entry)) };
    const missing = ['skill_id', 'kind', 'by', 'at']
      .filter((k) => rec[k] === null || rec[k] === undefined || rec[k] === '');
    if (missing.length) {
      throw new GateError(`GATE_BLOCKED：账目缺 ${JSON.stringify(missing)}`);
    }
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

  latestFor(skillId) {
    const found = this._records.filter((r) => r.skill_id === skillId);
    return found.length
      ? JSON.parse(JSON.stringify(found[found.length - 1])) : null;
  }
}
