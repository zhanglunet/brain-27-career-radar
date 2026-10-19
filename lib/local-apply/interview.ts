/**
 * PRD-080/T4 · 本地模拟面试（面试准备）
 *
 * v0.1 为纯规则版：问题集由机会字段 + 用户画像 + 缺口分析驱动模板生成，
 * 不调用任何模型。LLM 多轮对话为后续版本预留了钩子（见 LlmDialogueHook）。
 *
 * 数据主权红线（T1 §二/§五）：
 * - 本模块不得发起任何网络请求（无 fetch / WebSocket / 子进程联网）；
 * - 面试记录（问题、回答、复盘）只存本地，由调用方落盘 ~/.brain27/，
 *   永不上传、永不写回云端；
 * - 日志不得写入简历/材料片段（调用方在落盘与打日志前负责脱敏）。
 */

// ── 输入类型（最小本地类型；T2/T3 并行开发中，不依赖其代码） ──

export const INTERVIEW_CATEGORIES = [
  "research_depth",
  "motivation",
  "gap_followup",
] as const;

export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];

export const INTERVIEW_CATEGORY_LABELS: Record<InterviewCategory, string> = {
  research_depth: "研究方向深挖",
  motivation: "动机",
  gap_followup: "短板追问",
};

/** 机会侧最小画像：仅含 T1 §四-4.2 白名单中的公开字段 */
export type LocalOpportunity = {
  id: string;
  title: string;
  org: string;
  type?: string;
  region?: string;
  funding?: string;
  deadline?: string | null;
  keywords?: string[];
  mentor?: string[];
  description?: string;
};

/** 用户本地画像：永不出机器 */
export type LocalProfile = {
  education: string[];
  researchInterests: string[];
  skills: string[];
  experience: string[];
};

/** 缺口项：维度与 T2（三维度权重 0.5/0.3/0.2）对齐 */
export type GapDimension = "research_direction" | "mentor" | "requirements";

export type GapItem = {
  dimension: GapDimension;
  description: string;
  severity: "high" | "medium" | "low";
};

export type InterviewQuestion = {
  category: InterviewCategory;
  question: string;
  /** 考察什么 */
  intent: string;
  /** 回答思路（不是标准答案） */
  suggestedAngle: string;
};

export type MockAnswer = {
  questionIndex: number;
  answer: string;
};

export type MockSession = {
  opportunityId: string;
  questions: InterviewQuestion[];
  answers: MockAnswer[];
  startedAt: string;
  completedAt?: string;
};

export type ReviewPoint = {
  kind: "strength" | "gap" | "suggestion";
  text: string;
};

/**
 * LLM 对话钩子（预留，v0.1 未使用）。
 * 后续版本若接入本地 Ollama，可实现该钩子做多轮追问；
 * 云端 LLM 必须走 T1 §三-3.2 的逐次授权流程，本模块不直接调用。
 */
export type LlmDialogueHook = (
  history: { question: string; answer: string }[],
) => Promise<string>;

// ── 问题生成（规则版） ──

const pick = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

function researchDepthQuestions(
  opp: LocalOpportunity,
  profile: LocalProfile,
): InterviewQuestion[] {
  const qs: InterviewQuestion[] = [];
  const kws = (opp.keywords ?? []).filter(Boolean);
  const mentor = (opp.mentor ?? []).filter(Boolean)[0];

  qs.push({
    category: "research_depth",
    question: "请用 3 分钟介绍你最得意的一项研究：研究问题是什么、用了什么方法、你的具体贡献是什么？",
    intent: "考察研究深度、逻辑表达与对自己工作的拥有感",
    suggestedAngle:
      "按「问题→方法→你的贡献→结果/局限」四段讲，突出你独立解决的部分，不要复述导师的工作。",
  });

  if (kws.length > 0) {
    const kw = kws[0];
    qs.push({
      category: "research_depth",
      question: mentor
        ? `${opp.org} ${mentor} 的方向涉及${kw}，你在这块有什么积累？如果让你为这个项目设计第一个实验，你会怎么做？`
        : `${opp.org} 的这个项目涉及${kw}，你在这块有什么积累？如果让你设计第一个实验，你会怎么做？`,
      intent: "考察与目标方向的知识衔接 + 独立设计实验的能力",
      suggestedAngle:
        `先讲你已有的${kw}相关积累（课程/项目/论文），再给出一个具体、可操作的实验设计，说明对照组和预期结果。`,
    });
  }

  const interests = profile.researchInterests.filter(Boolean);
  if (interests.length > 0) {
    qs.push({
      category: "research_depth",
      question: `你的研究兴趣里有${interests[0]}，这个方向目前最大的开放问题是什么？你怎么看？`,
      intent: "考察对领域的文献敏感度与批判性思考",
      suggestedAngle:
        "点名 1-2 个具体的开放问题（最好能关联到 1 篇代表性工作），给出你自己的判断，而不是背综述。",
    });
  }

  return pick(qs, 3);
}

function motivationQuestions(opp: LocalOpportunity): InterviewQuestion[] {
  return [
    {
      category: "motivation",
      question: `为什么选择 ${opp.org} 而不是其他同方向的组？`,
      intent: "考察申请动机是否具体、是否做过功课",
      suggestedAngle:
        "必须具体到人/方向/资源（某位导师的某篇工作、某个平台/数据集），泛泛的「贵校声誉卓著」是减分项。",
    },
    {
      category: "motivation",
      question: "未来 3-5 年，你希望在这个方向上解决什么问题？博士毕业后想做什么？",
      intent: "考察学术规划的清晰度与现实感",
      suggestedAngle:
        "给出一个有层次的规划（博士期间解决什么小问题、长期关心什么大问题），职业去向诚实即可，不必迎合。",
    },
  ];
}

const GAP_DIMENSION_LABELS: Record<GapDimension, string> = {
  research_direction: "研究方向",
  mentor: "导师匹配",
  requirements: "申请条件",
};

function gapFollowupQuestions(gaps: GapItem[]): InterviewQuestion[] {
  return gaps
    .filter((g) => g.severity !== "low")
    .slice(0, 3)
    .map((g) => ({
      category: "gap_followup" as InterviewCategory,
      question: `你的背景里「${GAP_DIMENSION_LABELS[g.dimension]}：${g.description}」相对薄弱，面试官很可能会追问，你打算怎么回应和补足？`,
      intent: `考察对自身短板（${GAP_DIMENSION_LABELS[g.dimension]}）的认知与补救计划`,
      suggestedAngle:
        "承认短板 + 给出具体补救动作（正在学什么、计划做什么、时间表），不要辩解或回避。",
    }));
}

/**
 * 生成针对性问题集：三类必齐（研究方向深挖 / 动机 / 短板追问），
 * 顺序固定：先深挖、再动机、最后短板追问（由浅入深，符合真实面试节奏）。
 */
export function generateQuestions(
  opp: LocalOpportunity,
  profile: LocalProfile,
  gaps: GapItem[] = [],
): InterviewQuestion[] {
  const depth = researchDepthQuestions(opp, profile);
  const motivation = motivationQuestions(opp);
  const followups = gapFollowupQuestions(gaps);
  // 短板追问至少保留 1 题：无显式缺口时给一道通用版
  const followupsFinal =
    followups.length > 0
      ? followups
      : [
          {
            category: "gap_followup" as InterviewCategory,
            question:
              "回顾你的申请材料，你觉得自己相对最弱的一环是什么？如果面试官问到，你怎么回答？",
            intent: "考察自我认知与诚实度",
            suggestedAngle: "选一个真实的弱项，讲清楚它为什么弱、你正在做什么来补。",
          },
        ];
  return [...depth, ...motivation, ...followupsFinal];
}

// ── 模拟轮次（本地状态机） ──

export function startMockSession(
  opp: LocalOpportunity,
  questions: InterviewQuestion[],
  now: () => Date = () => new Date(),
): MockSession {
  return {
    opportunityId: opp.id,
    questions: [...questions],
    answers: [],
    startedAt: now().toISOString(),
  };
}

/** 记录一题的回答（返回新 session，不原地修改） */
export function answerQuestion(
  session: MockSession,
  questionIndex: number,
  answer: string,
): MockSession {
  if (questionIndex < 0 || questionIndex >= session.questions.length) {
    throw new RangeError(`questionIndex ${questionIndex} 越界`);
  }
  const answers = session.answers.filter((a) => a.questionIndex !== questionIndex);
  answers.push({ questionIndex, answer });
  answers.sort((a, b) => a.questionIndex - b.questionIndex);
  return { ...session, answers };
}

export function completeSession(
  session: MockSession,
  now: () => Date = () => new Date(),
): { session: MockSession; review: ReviewPoint[] } {
  const done: MockSession = { ...session, completedAt: now().toISOString() };
  return { session: done, review: generateReview(done) };
}

// ── 复盘（规则版） ──

const CJK_WORD_RE = /[\u4e00-\u9fff]/g;

function answerLength(answer: string): number {
  const cjk = (answer.match(CJK_WORD_RE) ?? []).length;
  const latin = answer
    .replace(CJK_WORD_RE, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjk + latin;
}

/**
 * 基于回答文本的启发式复盘（v0.1）：
 * - 回答过短（<30 字/词）→ gap；
 * - 提到与问题相关的关键词（机会关键词/导师名）→ strength；
 * - 未回答的题 → suggestion（建议准备）。
 * 明确局限：这是" checklist 式"复盘，不是语义理解；深度点评留给 LLM 钩子版本。
 */
export function generateReview(session: MockSession): ReviewPoint[] {
  const points: ReviewPoint[] = [];
  const answered = new Map(session.answers.map((a) => [a.questionIndex, a.answer]));

  session.questions.forEach((q, i) => {
    const label = INTERVIEW_CATEGORY_LABELS[q.category];
    const answer = answered.get(i);
    if (answer === undefined) {
      points.push({
        kind: "suggestion",
        text: `第 ${i + 1} 题（${label}）未作答：建议按「${q.suggestedAngle.slice(0, 24)}…」的思路准备一版回答。`,
      });
      return;
    }
    const len = answerLength(answer);
    if (len < 30) {
      points.push({
        kind: "gap",
        text: `第 ${i + 1} 题（${label}）回答过短（约 ${len} 字/词）：博士面试期待 2-3 分钟的结构化回答，建议扩充到「背景→做法→你的贡献→结论」四段。`,
      });
    } else {
      points.push({
        kind: "strength",
        text: `第 ${i + 1} 题（${label}）回答篇幅充分（约 ${len} 字/词），结构完整度看起来不错。`,
      });
    }
  });

  const total = session.questions.length;
  const doneCount = answered.size;
  if (doneCount === total && total > 0) {
    points.push({
      kind: "suggestion",
      text: `全部 ${total} 题已完成。下一步建议：挑 1 个最薄弱的回答做 3 遍出声练习，并准备 2 个你要反问面试官的问题。`,
    });
  } else if (total > 0) {
    points.push({
      kind: "suggestion",
      text: `已完成 ${doneCount}/${total} 题。建议先把未答的题补上，再做一次完整复盘。`,
    });
  }

  return points;
}
