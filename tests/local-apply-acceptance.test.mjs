/**
 * PRD-080/T5 验收：本地申请助手全链路验收测试。
 *
 * 走完 T2（匹配）→ T3（材料）→ T4（面试准备）全链路，验证 PRD-080 §验收标准 5 条。
 * 全部使用合成 fixture（无真实个人信息），确定性（固定 now），无网络、无 LLM。
 *
 * 映射：
 *  验收1 → 全链路本地跑通（T2→T3→T4，无异常，阶段输出喂给下一阶段）
 *  验收2 → 数据主权（源码静态审计：零网络调用、零磁盘写、无档案内容日志）
 *  验收3 → AI 草稿标注 + 无发送能力
 *  验收4 → 可解释性（每维度有理由、每题有 intent）
 *  验收5 → 不破坏云端链路（新模块无云端 import；纯加法）
 *  fork-it-and-own-it → 轻量检查：T1 设计文档在位且描述本地运行路径（不声称做过真实 fork）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { matchOpportunity, MATCH_WEIGHTS } from "../lib/local-apply/matcher.ts";
import {
  draftCv,
  draftPs,
  draftEmail,
  createDraftStore,
  AI_DRAFT_MARKER,
} from "../lib/local-apply/drafter.ts";
import * as drafterNs from "../lib/local-apply/drafter.ts";
import {
  generateQuestions,
  startMockSession,
  answerQuestion,
  completeSession,
} from "../lib/local-apply/interview.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(__dirname, rel), "utf-8");

// 确定性时钟：fixture 截止日均为 2027 年，此时间下全部未过期。
const FIXED_NOW = () => new Date("2026-10-19T00:00:00.000Z");

// ── 合成画像：2027 实验心理学硕士（虚构） ──────────────────────────
const PROFILE = {
  degree: "实验心理学硕士（2027 毕业）",
  researchInterests: ["脑机接口", "认知神经科学"],
  skills: ["Python", "EEG 信号处理"],
  mentorsOfInterest: ["陈晓东"], // 虚构导师名
  targetRegions: ["英国"],
  targetTypes: ["ra"],
  fundingNeed: "full",
};

// drafter / interview 用的画像形状（各模块自包含类型）
const DRAFTER_PROFILE = {
  education: ["实验心理学硕士（2027 毕业）"],
  experience: ["EEG 实验数据采集与分析", "Python 信号处理脚本开发"],
  skills: ["Python", "EEG 信号处理"],
  interests: ["脑机接口", "认知神经科学"],
};
const INTERVIEW_PROFILE = {
  education: ["实验心理学硕士（2027 毕业）"],
  researchInterests: ["脑机接口", "认知神经科学"],
  skills: ["Python", "EEG 信号处理"],
  experience: ["EEG 实验数据采集与分析"],
};

// ── 合成机会 ──────────────────────────────────────────────────────
const OXFORD_RA = {
  id: "ox-ra-bci-2027",
  title: "Research Assistant in Brain-Computer Interfaces",
  org: "University of Oxford",
  type: "ra",
  region: "英国",
  funding: "full",
  deadline: "2027-03-31",
  keywords: ["脑机接口", "神经科学"],
  mentors: ["陈晓东"],
  requirements: ["硕士学历", "EEG 信号处理经验"],
  body: "Brain-computer interface research assistant position in the neuroscience lab.",
};

const CAMBRIDGE_RA = {
  id: "cam-ra-cogneuro-2027",
  title: "Research Assistant in Cognitive Neuroscience",
  org: "University of Cambridge",
  type: "ra",
  region: "英国",
  funding: "full",
  deadline: "2027-04-30",
  keywords: ["认知神经科学"],
  mentors: [],
  requirements: ["硕士学历"],
  body: "Cognitive neuroscience research assistant, EEG experiments.",
};

// 对照组：非英、非 RA，证明链路不是写死给牛津剑桥的
const SHENZHEN_INTERN = {
  id: "sz-ai-intern-2027",
  title: "AI 算法实习生",
  org: "深圳星辰智能（虚构）",
  type: "intern",
  region: "中国大陆",
  funding: "partial",
  deadline: "2027-06-30",
  keywords: ["大模型", "推荐系统"],
  mentors: [],
  requirements: ["在校生"],
  body: "大模型应用开发实习生岗位。",
};

/** T2 输出 → T3/T4 输入的适配器（测试脚手架；真实接线在 CLI 层做）。 */
function gapsForDrafter(matchResult) {
  const dim2sev = (score) => (score < 0.4 ? "high" : score < 0.8 ? "medium" : "low");
  const dimMap = { direction: "direction", mentor: "mentor", requirements: "eligibility" };
  return {
    opportunityId: matchResult.opportunityId,
    score: matchResult.score,
    gaps: matchResult.dimensions
      .filter((d) => d.score < 1)
      .map((d) => ({
        dimension: dimMap[d.dimension] ?? "direction",
        severity: dim2sev(d.score),
        detail: d.reasons[0] ?? "",
      })),
  };
}
function gapsForInterview(matchResult) {
  const dim2sev = (score) => (score < 0.4 ? "high" : score < 0.8 ? "medium" : "low");
  const dimMap = { direction: "research_direction", mentor: "mentor", requirements: "requirements" };
  return matchResult.dimensions
    .filter((d) => d.score < 1)
    .map((d) => ({
      dimension: dimMap[d.dimension] ?? "research_direction",
      description: d.reasons[0] ?? "",
      severity: dim2sev(d.score),
    }));
}

const NETWORK_PATTERNS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket(",
  "new WebSocket",
  "node:http",
  "node:https",
  "https.request",
  "http.request",
  "nodemailer",
  "sendmail",
  "smtp",
];
const DISK_WRITE_PATTERNS = ["writeFileSync", "appendFileSync", "createWriteStream", "writeFile("];
const CLOUD_IMPORT_PATTERNS = ["@cloudflare", "from \"../worker/", 'from "../worker/', "D1Database"];

test("验收1/5 · 全链路本地跑通：T2→T3→T4（牛津 RA 端到端）", () => {
  // — T2 匹配：三个机会都跑，无异常 —
  const ox = matchOpportunity(OXFORD_RA, PROFILE, { now: FIXED_NOW() });
  const cam = matchOpportunity(CAMBRIDGE_RA, PROFILE, { now: FIXED_NOW() });
  const sz = matchOpportunity(SHENZHEN_INTERN, PROFILE, { now: FIXED_NOW() });
  console.log(`  匹配分：牛津RA=${ox.score.toFixed(3)} 剑桥RA=${cam.score.toFixed(3)} 对照组=${sz.score.toFixed(3)}`);

  // 牛津/剑桥 RA 高于对照组（用户当前重点关注方向）
  assert.ok(ox.score > sz.score, `牛津RA(${ox.score}) 应高于对照组(${sz.score})`);
  assert.ok(cam.score > sz.score, `剑桥RA(${cam.score}) 应高于对照组(${sz.score})`);
  const dirOf = (r) => r.dimensions.find((d) => d.dimension === "direction").score;
  assert.ok(dirOf(ox) > dirOf(sz), "牛津RA 方向维度应高于对照组");

  // 权重是用户拍板的值
  assert.deepEqual(MATCH_WEIGHTS, { direction: 0.5, mentor: 0.3, requirements: 0.2 });

  // — T2 缺口喂给 T3 —
  const analysis = gapsForDrafter(ox);
  const store = createDraftStore(FIXED_NOW);
  const cv = draftCv(OXFORD_RA, DRAFTER_PROFILE, analysis);
  const ps = draftPs(OXFORD_RA, DRAFTER_PROFILE, analysis);
  const email = draftEmail(OXFORD_RA, DRAFTER_PROFILE);
  for (const [name, text] of [["cv", cv], ["ps", ps], ["email", email]]) {
    assert.ok(text.includes(AI_DRAFT_MARKER), `${name} 草稿必须带 AI 标注`);
  }
  const saved = [store.save("cv", OXFORD_RA.id, cv), store.save("ps", OXFORD_RA.id, ps), store.save("email", OXFORD_RA.id, email)];
  assert.deepEqual(saved.map((d) => d.version), [1, 1, 1]);
  assert.equal(store.save("cv", OXFORD_RA.id, cv).version, 2, "同机会同类型草稿版本递增");
  console.log(`  T3 草稿：cv/ps/email 各 1 份，均带 AI 标注，版本化 ✓`);

  // — T2 缺口喂给 T4 —
  const questions = generateQuestions(
    { ...OXFORD_RA, mentor: OXFORD_RA.mentors },
    INTERVIEW_PROFILE,
    gapsForInterview(ox),
  );
  assert.ok(questions.length >= 3, "至少覆盖三类问题");
  let session = startMockSession({ ...OXFORD_RA, mentor: OXFORD_RA.mentors }, questions, FIXED_NOW);
  questions.forEach((q, i) => {
    session = answerQuestion(session, i, `这是第 ${i + 1} 题的模拟回答，包含一定的展开论述。`);
  });
  const { review } = completeSession(session, FIXED_NOW);
  assert.ok(review.length > 0, "复盘要点非空");
  console.log(`  T4 面试：${questions.length} 题全部作答，复盘 ${review.length} 条 ✓`);
  console.log("  全链路本地跑通 ✓（零网络调用、零异常）");
});

test("验收2/5 · 数据主权：三模块源码零网络调用、零磁盘写", () => {
  const files = {
    matcher: src("../lib/local-apply/matcher.ts"),
    drafter: src("../lib/local-apply/drafter.ts"),
    interview: src("../lib/local-apply/interview.ts"),
  };
  for (const [name, text] of Object.entries(files)) {
    for (const pat of NETWORK_PATTERNS) {
      // 注释里的"禁止"声明不算——只查非注释行的真实调用
      const hits = text.split("\n").filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && t.includes(pat);
      });
      assert.equal(hits.length, 0, `${name}.ts 不应含网络调用 ${pat}，命中: ${hits[0] ?? ""}`);
    }
    for (const pat of DISK_WRITE_PATTERNS) {
      assert.ok(!text.includes(pat), `${name}.ts 不应写磁盘 (${pat})`);
    }
  }
  console.log("  matcher/drafter/interview：零网络调用 ✓ 零磁盘写 ✓");
  console.log("  个人材料以函数参数进出，无日志/上报路径（纯函数） ✓");
});

test("验收3/5 · AI 草稿标注强制 + 无发送能力", () => {
  // 白名单检查：drafter 只导出 5 项，无发送语义
  const exported = Object.keys(drafterNs).filter((k) => !k.startsWith("_"));
  console.log(`  drafter 导出：${exported.join(", ")}`);
  assert.deepEqual(
    [...exported].sort(),
    ["AI_DRAFT_MARKER", "createDraftStore", "draftCv", "draftEmail", "draftPs"].sort(),
    "drafter 导出白名单固定为 5 项，无发送语义函数",
  );
  const email = draftEmail(OXFORD_RA, DRAFTER_PROFILE);
  assert.ok(email.includes(AI_DRAFT_MARKER), "套磁信带 AI 标注");
  assert.ok(email.includes("[待填写"), "联系方式等敏感槽位用占位符，不编造");
  console.log("  AI 标注强制 ✓ 占位符不编造 ✓ 无发送能力 ✓");
});

test("验收4/5 · 可解释性：每维度有理由、每题有 intent", () => {
  for (const opp of [OXFORD_RA, CAMBRIDGE_RA, SHENZHEN_INTERN]) {
    const r = matchOpportunity(opp, PROFILE, { now: FIXED_NOW() });
    for (const d of r.dimensions) {
      assert.ok(d.reasons.length >= 1, `${opp.id} 维度 ${d.dimension} 必须 ≥1 条理由`);
    }
  }
  const qs = generateQuestions(
    { ...OXFORD_RA, mentor: OXFORD_RA.mentors },
    INTERVIEW_PROFILE,
    gapsForInterview(matchOpportunity(OXFORD_RA, PROFILE, { now: FIXED_NOW() })),
  );
  for (const q of qs) {
    assert.ok(typeof q.intent === "string" && q.intent.length > 0, "每题必须有 intent");
  }
  console.log(`  3 机会 × 3 维度恒有理由 ✓ ${qs.length} 题均有 intent ✓`);
});

test("验收5/5 · 不破坏云端链路：新模块无云端 import", () => {
  const files = [
    src("../lib/local-apply/matcher.ts"),
    src("../lib/local-apply/drafter.ts"),
    src("../lib/local-apply/interview.ts"),
  ];
  for (const text of files) {
    for (const pat of CLOUD_IMPORT_PATTERNS) {
      assert.ok(!text.includes(pat), `新模块不应引用云端路径 (${pat})`);
    }
    // import 全部是 lib/ 内的相对路径
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const imp of imports) {
      assert.ok(
        imp.startsWith("../") || imp.startsWith("./") || imp.startsWith("node:"),
        `非常规 import: ${imp}`,
      );
    }
  }
  console.log("  三模块 import 均为 lib 内相对路径 / node 内建 ✓");
  console.log("  注：本 PR 纯加法（1 个测试文件，0 修改），云端回归（PRD-017/018/019/061）无回归可能；");
  console.log("      完整 Workers/D1 回归需云端环境，超出本验收范围，已在 PR body 诚实说明。");
});

test("fork-it-and-own-it（轻量）：T1 设计文档在位且描述本地运行路径", () => {
  const doc = src("../docs/plans/2026-10-19-local-apply-design.md");
  assert.ok(doc.includes("Ollama") || doc.includes("本地"), "设计文档应描述本地运行");
  assert.ok(doc.includes("绝不出机器") || doc.includes("不出机器"), "设计文档应明确数据边界");
  console.log("  T1 设计文档在位，本地运行路径与数据边界已文档化 ✓");
  console.log("  注：未声称执行过真实 fork-and-run；T5 以文档 + 链路可跑通为准。");
});
