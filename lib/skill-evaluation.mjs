// 技能评估最小实现：质量门 + 重叠检测（PRD-484/T2）。
//
// 按 brain-27-career-radar 的 T1 设计稿（docs/plans/2026-11-17-prd-484-brain-skill-evaluation-design.md）实现 T2 范围：
// 质量门（设计稿 §一）+ 重叠检测（设计稿 §二），产出首份评估报告落账。
// 合成评测集与实测（设计稿 §三/§四）不在 T2 范围，留待后续任务。
//
// 方法说明（诚实口径）：
// - 重叠检测的文本相似度用词元集合 Jaccard：ASCII 词 + 中文字符 bigram；
//   它是设计稿“嵌入向量余弦”的最小可用代理——T2 不引入外部 embedding 服务，
//   阈值仍按设计稿取 0.8（≥0.8 记“疑似重叠”，只进待核查清单，不自动合并，
//   行为层确认留待人工复核）。
// - 质量门只按评估清单（inventory.json）里的对照跑分判；尚无跑分时样本量为 0，
//   按设计稿判“证据不足”，不判通过也不判失效，不编造跑分数据。
// - 评估结论只进整改清单/待核查清单；技能下线另走审批，绝不直接删技能。
//
// 纯 Node 标准库，零网络依赖。可直接运行：
//   node skill-evaluation.mjs --inventory skill-eval/inventory.json \
//     --report skill-eval/reports/2026-11-17-evaluation.md
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const VERDICT_PASS = '通过';
export const VERDICT_REMEDIATE = '整改';
export const VERDICT_INSUFFICIENT = '证据不足';

const CJK_RUN = /[\u4e00-\u9fff]+/g;
const WORD = /[a-z0-9]{2,}/g;

// 词元集合：ASCII 词（小写）+ 中文字符 bigram。
export function tokenize(text) {
  const tokens = new Set();
  for (const word of text.toLowerCase().match(WORD) ?? []) tokens.add(`w:${word}`);
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) tokens.add(`c:${run.slice(i, i + 2)}`);
  }
  return tokens;
}

// Jaccard 相似度；两空集记 1.0，一空一非空记 0.0。
export function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1.0;
  if (left.size === 0 || right.size === 0) return 0.0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter++;
  return inter / (left.size + right.size - inter);
}

// 去 SKILL.md 的 YAML frontmatter，但保留 description 行正文。
export function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  let description = '';
  for (const line of text.slice(3, end).split('\n')) {
    if (line.trim().startsWith('description:')) {
      description = line.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
  return `${description}\n${text.slice(end + 4)}`;
}

// 全量两两比对。返回按相似度倒序的全部配对；similarity ≥ threshold 为疑似重叠。
export function overlapPairs(skills, threshold) {
  const tokenSets = new Map(skills.map((s) => [s.id, tokenize(s.text)]));
  const pairs = [];
  const ids = skills.map((s) => s.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sim = jaccard(tokenSets.get(ids[i]), tokenSets.get(ids[j]));
      pairs.push({ a: ids[i], b: ids[j], similarity: Math.round(sim * 1000) / 1000, suspected: sim >= threshold });
    }
  }
  pairs.sort((p, q) => q.similarity - p.similarity || (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
  return pairs;
}

function errorRate(metrics) {
  // 483/484 的错误率字段名与 479/480 不同（error_rate / false_signal_rate），都认。
  const error = metrics.error_rate ?? metrics.false_signal_rate ?? null;
  const control = metrics.control_error_rate ?? metrics.control_false_signal_rate ?? null;
  return [error, control];
}

// 479/480 口径：错误率相对下降 ≥ 阈值且新增错误类型为 0；样本不足判证据不足。
export function gateErrorRate(metrics, thresholds) {
  const minSample = thresholds.min_sample_tasks;
  const sample = metrics.sample_tasks ?? null;
  if (sample === null || sample < minSample) return [VERDICT_INSUFFICIENT, `样本量 ${sample} < ${minSample}，不判通过`];
  const withRate = metrics.error_rate_with_skill ?? null;
  const withoutRate = metrics.error_rate_without_skill ?? null;
  const newTypes = metrics.new_error_types ?? null;
  if (withRate === null || withoutRate === null || newTypes === null) {
    return [VERDICT_INSUFFICIENT, '缺少对照跑分（错误率/新增错误类型未记录）'];
  }
  if (withoutRate <= 0) return [VERDICT_INSUFFICIENT, '对照组错误率为 0，无可比下降空间'];
  const drop = (withoutRate - withRate) / withoutRate;
  const minDrop = thresholds.min_relative_error_drop;
  const maxNew = thresholds.max_new_error_types;
  if (drop >= minDrop && newTypes <= maxNew) {
    return [VERDICT_PASS, `错误率相对下降 ${Math.round(drop * 100)}%（要求 ≥${Math.round(minDrop * 100)}%），新增错误类型 ${newTypes}`];
  }
  return [VERDICT_REMEDIATE, `错误率相对下降 ${Math.round(drop * 100)}%（要求 ≥${Math.round(minDrop * 100)}%），新增错误类型 ${newTypes}（要求 ≤${maxNew}）`];
}

// 483/484 口径：错误率/行为改变率/采纳率三项硬指标；任一不达标即未过关；样本不足判证据不足。
export function gateRateTrio(metrics, thresholds) {
  const minSample = thresholds.min_sample_tasks;
  const sample = metrics.sample_tasks ?? null;
  if (sample === null || sample < minSample) return [VERDICT_INSUFFICIENT, `样本量 ${sample} < ${minSample}，不判通过`];
  const [error, control] = errorRate(metrics);
  const behavior = metrics.behavior_change_rate ?? null;
  const adoption = metrics.adoption_rate ?? null;
  if (error === null || control === null || behavior === null || adoption === null) {
    return [VERDICT_INSUFFICIENT, '缺少对照跑分（错误率/行为改变率/采纳率未记录）'];
  }
  const reasons = [];
  const label = thresholds.error_label ?? '错误率';
  const maxError = thresholds.max_error_rate;
  if (error > maxError) reasons.push(`${label} ${Math.round(error * 100)}% > 上限 ${Math.round(maxError * 100)}%`);
  if (error > control * thresholds.max_error_vs_control_ratio) {
    reasons.push(`${label} ${Math.round(error * 100)}% 高于对照组 ${Math.round(control * 100)}% 的一半`);
  }
  const minBehavior = thresholds.min_behavior_change_rate;
  if (behavior < minBehavior) reasons.push(`行为改变率 ${Math.round(behavior * 100)}% < ${Math.round(minBehavior * 100)}%`);
  const minAdoption = thresholds.min_adoption_rate;
  if (adoption < minAdoption) reasons.push(`采纳率 ${Math.round(adoption * 100)}% < ${Math.round(minAdoption * 100)}%`);
  if (reasons.length > 0) return [VERDICT_REMEDIATE, reasons.join('；')];
  return [VERDICT_PASS, `${label} ${Math.round(error * 100)}%、行为改变率 ${Math.round(behavior * 100)}%、采纳率 ${Math.round(adoption * 100)}% 均达标`];
}

const GATES = { 'error-rate': gateErrorRate, 'rate-trio': gateRateTrio };

// 对一份评估清单跑质量门 + 重叠检测，返回报告对象（JSON 可序列化）。
export function evaluate(inventory) {
  const thresholds = inventory.thresholds;
  const gate = GATES[inventory.gate];
  const verdicts = inventory.skills.map((skill) => {
    const [verdict, reason] = gate(skill.metrics, thresholds);
    return { id: skill.id, verdict, reason };
  });
  const pairs = overlapPairs(inventory.skills, thresholds.overlap_similarity);
  const suspected = pairs.filter((p) => p.suspected);
  return {
    prd: inventory.prd,
    repo: inventory.repo,
    date: inventory.generated_at,
    design_ref: inventory.design_ref,
    inventory_version: inventory.version,
    thresholds,
    skill_count: inventory.skills.length,
    pair_count: pairs.length,
    verdicts,
    pairs,
    suspected,
    remediation_candidates: verdicts.filter((v) => v.verdict === VERDICT_REMEDIATE),
  };
}

// 报告对象 → 落账用的 Markdown（append-only：每次评估新起一份带日期的文件）。
export function renderReport(report) {
  const lines = [
    `# 技能评估报告（首份，${report.date}）`,
    '',
    `- PRD：PRD-${report.prd}（${report.repo}）`,
    `- 设计依据：${report.design_ref}`,
    `- 评估清单版本：v${report.inventory_version}，技能 ${report.skill_count} 个`,
    `- 阈值：\`${JSON.stringify(report.thresholds)}\`（设计稿草稿阈值，待评审定稿、实测后复核）`,
    '',
    '## 一、质量门',
    '',
    '| 技能 | 结论 | 原因 |',
    '|---|---|---|',
  ];
  for (const v of report.verdicts) lines.push(`| ${v.id} | ${v.verdict} | ${v.reason} |`);
  lines.push(
    '',
    '## 二、重叠检测',
    '',
    `全量两两比对 ${report.pair_count} 对；疑似重叠（相似度 ≥ 阈值）${report.suspected.length} 对。`,
    '相似度为词元集合 Jaccard（设计稿嵌入余弦的最小可用代理，T2 不引入外部 embedding 服务）。',
    '',
    '| 技能 A | 技能 B | 相似度 | 疑似重叠 |',
    '|---|---|---|---|',
  );
  for (const p of report.pairs) {
    lines.push(`| ${p.a} | ${p.b} | ${p.similarity.toFixed(3)} | ${p.suspected ? '是' : '否'} |`);
  }
  lines.push('', '## 三、待核查清单（疑似重叠）', '');
  if (report.suspected.length > 0) {
    for (const p of report.suspected) {
      lines.push(`- ${p.a} ↔ ${p.b}（相似度 ${p.similarity.toFixed(3)}）：只进待核查清单，不自动合并；行为层确认与合并/拆分/保留分工由人决定。`);
    }
  } else {
    lines.push('无。');
  }
  lines.push('', '## 四、整改清单候选（质量门未过关）', '');
  if (report.remediation_candidates.length > 0) {
    for (const v of report.remediation_candidates) lines.push(`- ${v.id}：${v.reason}`);
  } else {
    lines.push('无。质量门结论为“证据不足”的技能不在此列——证据不足不是失效，待对照跑分补测。');
  }
  lines.push(
    '',
    '## 五、方法与诚实声明',
    '',
    '- 本报告由评估脚本按评估清单自动生成；清单里的技能文本取自仓库 main 上的真实技能文件（路径见清单）。',
    '- 质量门样本量为 0 的技能判“证据不足”：T2 只跑门逻辑与重叠检测，真实对照跑分（A/B）在后续实测试运行；不编造跑分数据。',
    '- 评估结论只进整改清单/待核查清单；技能下线另走审批，绝不因评估未过关直接删技能。',
    '',
  );
  return lines.join('\n');
}

export function loadInventory(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--inventory') out.inventory = argv[++i];
    else if (argv[i] === '--report') out.report = argv[++i];
  }
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inventory || !args.report) {
    console.error('用法：node skill-evaluation.mjs --inventory <清单 JSON> --report <报告 Markdown>');
    process.exit(2);
  }
  const report = evaluate(loadInventory(args.inventory));
  mkdirSync(args.report.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(args.report, renderReport(report), 'utf-8');
  const counts = {};
  for (const v of report.verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  console.log(JSON.stringify({
    skill_count: report.skill_count,
    pair_count: report.pair_count,
    suspected: report.suspected.length,
    verdicts: counts,
    report: args.report,
  }));
}
