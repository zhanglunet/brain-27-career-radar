// PRD-577/T2（trend issue #2896 的 T2 环节）：brain-27-career-radar 产物红队巡检最小实现。
//
// 按 T1 设计（docs/plans/2026-11-20-prd-577-brain-hunting-design.md）落地红队巡检：
//   - SUSPECTS：疑点封闭词表（4 项攻击面，落账不猜）；
//   - reproduce：复现器——复现/不复现二值返回（无复现证据的 finding 不入账）；
//   - runHunt：全疑点巡检 → 报告（有发现/无可复现发现，结论封闭）；
//   - FindingLedger：FINDING JSONL append-only 留痕（四件缺一拒绝入账）；
//   - main()：agent-native CLI（--artifact --report）。
// 零网络零子进程；示例全虚构占位。
// 测试：tests/hunting-pack.test.mjs
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const HUNT_SCHEMA = 'brain-hunt/v1';
export const SUSPECTS = ["S1_过期信号", "S2_矛盾信号", "S3_噪声注入", "S4_来源失效"];
export const REPRO_VERDICTS = ['复现', '不复现'];
export const HUNT_CONCLUSIONS = ['有发现', '无可复现发现'];
export const FINDING_REQUIRED = ['finding', 'repro', 'evidence', 'found_at'];
export const HUNT_TS = '2026-11-20T09:00:00Z';

export class HuntError extends Error {}

const tail = (s) => s.split('_', 2)[1] || s;

export function reproduce(suspect, artifact) {
  /** 复现器：在产物上跑该疑点的攻击面检查（二值返回）。 */
  const text = String((artifact && artifact.text) || '');
  const token = tail(suspect);
  const hit = text.includes(token);
  return { suspect,
           verdict: hit ? '复现' : '不复现',
           evidence: hit ? '命中：' + token + '（占位）' : '无命中（占位）' };
}

const deepCopy = (x) => JSON.parse(JSON.stringify(x));

export function runHunt(artifact) {
  /** 全疑点巡检跑一遍，返回巡检报告（含可入账 finding 条目）。 */
  const results = SUSPECTS.map((s) => reproduce(s, artifact));
  const findings = results.filter((r) => r.verdict === '复现')
    .map((r) => ({ finding: r.suspect + '：' + r.evidence,
                   repro: '复现', evidence: r.evidence,
                   found_at: HUNT_TS }));
  const hunt = findings.length ? '有发现' : '无可复现发现';
  return { schema: HUNT_SCHEMA,
           artifact: String((artifact && artifact.name) || ''),
           suspects: [...SUSPECTS], results, findings, hunt };
}

export class FindingLedger {
  /** FINDING JSONL append-only 留痕（四件缺一拒绝入账）。 */
  constructor(path = null) {
    this._records = [];
    this._path = path;
  }

  record(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HuntError('FINDING_INVALID：条目非对象');
    }
    const missing = FINDING_REQUIRED.filter((k) => typeof entry[k] !== 'string'
                                            || !String(entry[k]).trim());
    if (missing.length) {
      throw new HuntError('FINDING_INCOMPLETE：FINDING 条目缺 '
        + JSON.stringify(missing));
    }
    if (!REPRO_VERDICTS.includes(entry.repro)) {
      throw new HuntError('REPRO_INVALID：repro 必须是 复现/不复现'
        + '（无复现证据的 finding 不入账）');
    }
    const rec = deepCopy({ schema: HUNT_SCHEMA, ...entry });
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
  /** agent-native CLI：--artifact <产物文本> --report <输出 json>。 */
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const artifactPath = get('--artifact');
  const reportPath = get('--report');
  if (!artifactPath || !reportPath) {
    throw new HuntError('USAGE：--artifact <产物文本> --report <输出 json>');
  }
  const text = readFileSync(artifactPath, 'utf8');
  const report = runHunt({ name: '产物（占位）', text,
                           source_path: artifactPath });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 1), 'utf8');
  return { hunt: report.hunt, findings: report.findings.length };
}
