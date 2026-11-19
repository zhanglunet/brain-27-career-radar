// PRD-554/T2（trend issue #2689 的 T2 环节）：brain-27-career-radar 技能准入检查最小实现。
//
// 按 T1 设计（docs/plans/2026-11-20-prd-554-brain-admission-design.md）落地五层准入检查：
//   - L1 质量门：SKILL.md 静态完整性五项（缺项进整改）；
//   - L2 安全扫描：文本规则扫描（命中=不过）；
//   - L3 重叠检测：与已有技能 bigram Jaccard >= 0.8 记疑似（不自动判死）；
//   - L4 合成评测集：SKILL.md 内容生成合成题（Q/A/钉值），带钉值才有效；
//   - L5 实测评估：无对照数据判「待补测」（不编造结论）。
//   - AdmissionLedger：检查结果 JSONL append-only 留痕（四件缺一拒绝入账）。
//   - main()：agent-native CLI（--skill --report）。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/2689
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ADMISSION_SCHEMA = 'brain-admission/v1';
export const LAYERS = ['L1_quality', 'L2_security', 'L3_overlap',
                       'L4_synth', 'L5_live'];
export const VERDICTS = ['过', '不过', '疑似', '待补测'];
export const ENTRY_REQUIRED = ['layer', 'verdict', 'evidence', 'checked_at'];
export const OVERLAP_THRESHOLD = 0.8;
export const STATIC_KEYS = ['name', 'description', 'trigger', 'constraints',
                            'evidence'];

export class AdmissionError extends Error {}

export function frontmatter(text) {
  if (typeof text === 'string' && text.startsWith('---')) {
    const end = text.indexOf('---', 3);
    if (end > 0) return text.slice(3, end);
  }
  return '';
}

export function scalar(fm, key) {
  const m = fm.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

export function staticChecks(skill) {
  /** L1 质量门：SKILL.md 静态完整性五项。 */
  const fm = frontmatter(skill.text || '');
  const lower = (fm + ' ' + (skill.source_path || '')).toLowerCase();
  return {
    name: Boolean(scalar(fm, 'name')),
    description: Boolean(scalar(fm, 'description')),
    trigger: fm.includes('当') || fm.includes('使用') || fm.includes('触发'),
    constraints: fm.includes('不') || fm.includes('约束')
      || fm.includes('限制'),
    evidence: fm.includes('来源') || fm.includes('出处')
      || lower.includes('reference') || Boolean(skill.source_path),
  };
}

function bigrams(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  const out = new Set();
  if (clean.length < 2) {
    if (clean) out.add(clean);
    return out;
  }
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

export function securityScan(skill) {
  /** L2 安全扫描：取数越界/敏感表扫描。 */
  const text = String(skill.text || '').toLowerCase();
  const hits = ['DROP TABLE', 'rm -rf /', 'sudo ', 'eval(', 'API_KEY=',
                'password =', '密钥硬编码'].filter((p) => text.includes(p.toLowerCase()));
  return { layer: 'L2_security', verdict: hits.length ? '不过' : '过', hits };
}

export function overlapCheck(skill, existing) {
  /** L3 重叠检测：与已有技能 bigram Jaccard >= 0.8 记疑似。 */
  const grams = bigrams(skill.text || '');
  const suspects = (existing || []).map((ex) => ({
    ex, sim: jaccard(grams, bigrams(ex.text || '')),
  })).filter((x) => x.sim >= OVERLAP_THRESHOLD)
    .map((x) => ({ against: x.ex.id || '', similarity: Math.round(x.sim * 1000) / 1000 }));
  return { layer: 'L3_overlap', verdict: suspects.length ? '疑似' : '过',
           suspects };
}

export function synthEval(skill) {
  /** L4 合成评测集：从 SKILL.md 内容生成合成题（Q/A/钉值）。 */
  const text = String(skill.text || '');
  const name = skill.name || 'unknown';
  const questions = [];
  if (text) {
    questions.push({
      q: name + ' 的适用场景是什么？（合成题）',
      a_expected: scalar(frontmatter(text), 'description')
        || '见 SKILL.md description（钉值）',
      pin: 'SKILL.md description 原文',
    });
  }
  return { layer: 'L4_synth', verdict: questions.length ? '过' : '待补测',
           questions };
}

export function liveEval() {
  /** L5 实测评估：无对照数据判「待补测」（不编造结论）。 */
  return { layer: 'L5_live', verdict: '待补测',
           reason: '无有技能 vs 无技能对照数据（不编造）' };
}

export function runAdmission(skill, existing) {
  /** 五层检查跑一遍，返回准入报告（含留痕条目）。 */
  const l1 = staticChecks(skill);
  const missing = STATIC_KEYS.filter((k) => !l1[k]);
  const l2 = securityScan(skill);
  const l3 = overlapCheck(skill, existing || []);
  const l4 = synthEval(skill);
  const l5 = liveEval();
  const layers = [
    { layer: 'L1_quality', verdict: missing.length ? '不过' : '过',
      evidence: '缺项：' + (missing.length ? missing.join('/') : '无') },
    { layer: 'L2_security', verdict: l2.verdict,
      evidence: '命中：' + (l2.hits.length ? l2.hits.join('/') : '无') },
    { layer: 'L3_overlap', verdict: l3.verdict,
      evidence: '疑似：' + l3.suspects.length + ' 对' },
    { layer: 'L4_synth', verdict: l4.verdict,
      evidence: '合成题：' + l4.questions.length + ' 道' },
    { layer: 'L5_live', verdict: l5.verdict, evidence: l5.reason },
  ];
  let admission;
  if (layers.some((l) => l.verdict === '不过')) admission = '不进（整改）';
  else if (layers.some((l) => l.verdict === '疑似')) admission = '待复核';
  else if (layers.some((l) => l.verdict === '待补测')) admission = '待补测';
  else admission = '可进收件箱';
  const frozen = JSON.parse(JSON.stringify(layers));
  return { schema: ADMISSION_SCHEMA, skill: skill.name || '',
           layers: frozen, admission, static_checks: l1, security: l2,
           overlap: l3, synth: l4, live: l5 };
}

const deepCopy = (x) => JSON.parse(JSON.stringify(x));

export class AdmissionLedger {
  /** 检查结果 JSONL append-only 留痕（四件缺一拒绝入账）。 */
  constructor(path = null) {
    this._records = [];
    this._path = path;
  }

  record(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AdmissionError('ENTRY_INVALID：条目非对象');
    }
    const missing = ENTRY_REQUIRED.filter((k) => typeof entry[k] !== 'string'
                                            || !String(entry[k]).trim());
    if (missing.length) {
      throw new AdmissionError('ENTRY_INCOMPLETE：留痕条目缺 '
        + JSON.stringify(missing));
    }
    const rec = deepCopy({ schema: ADMISSION_SCHEMA, ...entry });
    this._records.push(deepCopy(rec));
    if (this._path !== null) {
      mkdirSync(dirname(this._path), { recursive: true });
      appendFileSync(this._path, JSON.stringify(rec) + '\n', 'utf8');
    }
    return deepCopy(rec);
  }

  entries() {
    return this._records.map(deepCopy);
  }
}

export function main(argv = []) {
  /** agent-native CLI：--skill <SKILL.md> --report <输出 json>。 */
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const skillPath = get('--skill');
  const reportPath = get('--report');
  if (!skillPath || !reportPath) {
    throw new AdmissionError('USAGE：--skill <SKILL.md> --report <输出 json>');
  }
  const text = readFileSync(skillPath, 'utf8');
  const skill = {
    name: scalar(frontmatter(text), 'name') || 'unknown',
    text,
    source_path: skillPath,
  };
  const report = runAdmission(skill, []);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 1), 'utf8');
  return { admission: report.admission, skill: report.skill };
}
