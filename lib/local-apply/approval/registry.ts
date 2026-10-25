/**
 * 不可逆动作注册表（Action Registry）—— PRD-175/T2（trend #876）。
 *
 * T1 规范：PRD-175/T1《批准队列 schema + 不可逆动作清单》（中央仓库
 * zhanglunet/trend，adopted/drafts/prd-175-pre-apply-approval-gate-t1.md，
 * PR 链接 https://github.com/zhanglunet/brain-27-career-radar/pull/62）。
 * 本文件按 T1 §二落地，**不得擅自增删动作枚举与字段**。
 *
 * 注册规则（T1 §2.2）：
 * 1. default-deny：执行层只认注册表内的 action_kind；未注册动作一律拒绝，
 *    并写 `bypass_blocked` 审计事件（见 gate.ts）。
 * 2. 单一执行口：一切不可逆动作必须经 `approval/gate.ts` 的执行口发出；
 *    cli/docx 等既有模块不得新增任何发送/提交调用（代码评审红线项）。
 * 3. dry-run 与幂等：每个注册动作必须声明 dry_run 与幂等键参与字段；
 *    gate.preview() 是统一的 dry-run 入口（预演输出但不执行、不改状态）。
 * 4. 载荷最小化：队列只存动作元数据与 draft_ref 引用，不复制材料正文。
 *
 * 借鉴声明（T1 禁复用）：open-duet（Apache-2.0）按 PRD-175 非目标
 * **绝不复用其代码**，只借鉴「行动前批准（approve-before-act）」产品思路；
 * 本清单与状态机为自研设计，与其实现零代码血缘。
 */

/** 不可逆动作枚举（T1 §2.1 注册表，四项，不得增删）。 */
export type ActionKind =
  | "email_send"
  | "webform_submit"
  | "file_export_final"
  | "profile_share";

export type RiskLevel = "high" | "medium";

/** 单条注册项（T1 §2.1 行的字段化）。 */
export type RegisteredAction = {
  kind: ActionKind;
  /** 风险级（T1 §2.1）。 */
  risk: RiskLevel;
  /** draft_ref 是否必填：A1/A2 必填（投递/邮件必须引用 materials 草稿）。 */
  draftRefRequired: boolean;
  /**
   * guard_flags 是否强制携带：T1 §5.5——A1/A2 请求生成时强制携带上游
   * posting-guard 结论（可为空数组，但字段必须存在，防"忘了扫描"）。
   */
  guardFlagsRequired: boolean;
  /** 为何不可逆（一句话；确认界面/审计展示用）。 */
  whyIrreversible: string;
  /**
   * 幂等键参与字段（T1 §3.2：action_kind + opportunity_id + draft_ref +
   * 收件人/URL）；targetPayloadKeys 是从 payload 提取"收件人/URL"的候选键，
   * 按序取第一个非空值。
   */
  targetPayloadKeys: readonly string[];
  /** T1 §2.2 #3：无 dry_run 的动作不得注册；gate.preview() 统一承担预演。 */
  dryRun: true;
};

/** 注册表（T1 §2.1 四项；顺序即 A1→A4）。 */
export const ACTION_REGISTRY: Readonly<Record<ActionKind, RegisteredAction>> = {
  email_send: {
    kind: "email_send",
    risk: "high",
    draftRefRequired: true,
    guardFlagsRequired: true,
    whyIrreversible: "邮件发出即到达对方，无法撤回",
    targetPayloadKeys: ["to", "recipient", "email"],
    dryRun: true,
  },
  webform_submit: {
    kind: "webform_submit",
    risk: "high",
    draftRefRequired: true,
    guardFlagsRequired: true,
    whyIrreversible: "第三方系统入库，留下投递痕迹，不可代为删除",
    targetPayloadKeys: ["url", "target_url", "form_url"],
    dryRun: true,
  },
  file_export_final: {
    kind: "file_export_final",
    risk: "medium",
    draftRefRequired: false,
    guardFlagsRequired: false,
    whyIrreversible: "导出物可能被直接拖进第三方网站；去标注后不再带 AI 声明",
    targetPayloadKeys: ["url", "output_name"],
    dryRun: true,
  },
  profile_share: {
    kind: "profile_share",
    risk: "high",
    draftRefRequired: false,
    guardFlagsRequired: false,
    whyIrreversible: "个人数据一旦离开本机不可收回",
    targetPayloadKeys: ["url", "recipient", "share_to"],
    dryRun: true,
  },
};

/** T2 收口对象：A1/A2（T1 §2.1 处置 + §六拍板 #3：A3/A4 登记留痕、先全走人工）。 */
export const T2_ENFORCED_KINDS: readonly ActionKind[] = ["email_send", "webform_submit"];

export function isActionKind(kind: unknown): kind is ActionKind {
  return typeof kind === "string" && kind in ACTION_REGISTRY;
}

/** 未注册动作返回 undefined（default-deny 的判定原语）。 */
export function getRegisteredAction(kind: string): RegisteredAction | undefined {
  return isActionKind(kind) ? ACTION_REGISTRY[kind] : undefined;
}
