// PRD-484/T4 测试（trend #2343 的 T4 环节）：机会技能评估划界断言。
//
// 运行：node --test tests/skill-evaluation-boundary.test.mjs（仓库根执行）
//
// 按 PRD 任务拆分 T4 行：评估与独立验收测试/验证台/评审流水线/监督回路的
// 边界断言——评估不越界审产物、不审过程：
//   - 评估双模块（T2 评估 + T3 闸门）对邻居模块（评审流水线/协同会话/
//     监督台/下游载体）零触碰（词面扫描，注释已隔离）；
//   - 借鉴仓（SkillEvaluator/BugHunter/stitch-skills）零符号（仅代码扫描）；
//   - 下游载体词零出现；
//   - 红线钉值：疑似重叠拦下不自动合并/未知技能显形拒绝/无发布路径/
//     闸门只读报告不重跑评估（纯函数零副作用）；
//   - 词表封闭 + 源扫描零网络零子进程。
// 只断言，不改任何生产代码。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate } from '../lib/skill-evaluation.mjs';
import { BLOCK_REASON_CODES, GATE_AUDIT_KINDS, GateError, checkGate }
  from '../lib/skill_evaluation_gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-17T10:00:00Z';
const BY = 'reviewer（占位）';
const NEIGHBORS = ["opportunity_collab_session", "opportunity_review_pipeline", "opportunity_supervision_bench"];
const CARRIERS = ["crawler"];
const srcOf = { 'skill-evaluation.mjs': '../lib',
  'skill_evaluation_gate.mjs': '../lib' };

const codeOf = (name) => readFileSync(join(HERE, srcOf[name], name), 'utf-8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const EVAL_MODULES = ["skill-evaluation.mjs", "skill_evaluation_gate.mjs"];

test('邻居模块零触碰（词面零出现，仅代码扫描）', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod);
    for (const stem of NEIGHBORS) {
      assert.ok(!code.includes(stem), `${mod} 出现邻居 ${stem}`);
    }
  }
});

test('下游载体词零出现', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod);
    for (const w of CARRIERS) {
      assert.ok(!code.includes(w), `${mod} 出现下游载体 ${w}`);
    }
  }
});

test('借鉴仓零符号（SkillEvaluator/BugHunter/stitch-skills）', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod).toLowerCase();
    for (const w of ['skillevaluator', 'bughunter', 'stitch_skills']) {
      assert.ok(!code.includes(w), `${mod} 出现借鉴词 ${w}`);
    }
  }
});

test('无发布路径（词面零出现）', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod).toLowerCase();
    for (const w of ['publishskill', 'deleteskill', 'removeskill',
                     'mergeskill']) {
      assert.ok(!code.includes(w), `${mod} 出现 ${w}`);
    }
  }
});

test('源扫描零网络零子进程', () => {
  for (const mod of EVAL_MODULES) {
    const src = readFileSync(join(HERE, srcOf[mod], mod), 'utf-8');
    for (const banned of ['node:child_process', 'node:http', 'node:https',
                          'node:net', 'fetch(']) {
      assert.ok(!src.includes(banned), `${mod} 出现 ${banned}`);
    }
  }
});


const THRESHOLDS = { min_sample_tasks: 20, min_relative_error_drop: 0.2,
                     max_new_error_types: 0, overlap_similarity: 0.8 };
const PASS_METRICS = { sample_tasks: 25, error_rate_with_skill: 0.10,
                       error_rate_without_skill: 0.40, new_error_types: 0 };

function makeReport() {
  return evaluate({ prd: 484, repo: 'brain-27-career-radar', generated_at: '2026-11-17',
                    version: 1, gate: 'error-rate', thresholds: THRESHOLDS,
                    skills: [{ id: 'skill-a',
                               text: 'skill-a 占位文本',
                               metrics: PASS_METRICS }] });
}

test('红线：疑似重叠拦下不自动合并（过关也拦）', () => {
  const report = makeReport();
  report.suspected = [{ a: 'skill-a', b: 'other', similarity: 0.9,
                        suspected: true }];
  const d = checkGate(report, 'skill-a');
  assert.equal(d.allowed, false);
  assert.ok(d.reasons.some((r) => r.code === 'SUSPECTED_OVERLAP'));
});

test('红线：未知技能显形拒绝', () => {
  assert.throws(() => checkGate(makeReport(), 'ghost'), /UNKNOWN_SKILL/);
});

test('红线：闸门只读报告不重跑评估（纯函数零副作用）', () => {
  const report = makeReport();
  const before = JSON.stringify(report);
  checkGate(report, 'skill-a');
  assert.equal(JSON.stringify(report), before);
});

test('词表封闭', () => {
  assert.deepEqual([...BLOCK_REASON_CODES].sort(),
                   ['BAD_REPORT', 'INSUFFICIENT_EVIDENCE', 'REMEDIATE',
                    'SUSPECTED_OVERLAP', 'UNKNOWN_SKILL'].sort());
  assert.deepEqual([...GATE_AUDIT_KINDS].sort(),
                   ['gate_blocked', 'gate_passed', 'remediation'].sort());
});

