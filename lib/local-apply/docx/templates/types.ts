/**
 * PRD-150/T2 · 模板声明 DSL（T1 §2.1：模板 = 版式定义 + 字段插槽，
 * 以声明式 slot 标记写在 templates/ 下，渲染引擎在 ../render.ts）。
 *
 * 模板自身只产出"块 + 插槽路径"的声明数据；排版（字体/字号/行距/缩进）
 * 由 render.ts 按中文排版约定（T1 §2.4）统一解释。
 */

/** 模板标识（对应 T1 §2.1 两套模板）。 */
export type TemplateId = "resume" | "cover-letter";

/**
 * 行内部件：固定文字或字段插槽。
 * - `slot`：字段路径（如 `basics.email`、`experience[0].title`、`skills`），
 *   由渲染引擎按上下文解析；复合路径（skills/outputs[i] 等）解析为拼接文本；
 * - `required`：缺失时留 `[待填写：路径]` 占位符（T1 §3.2 必选规则）；
 * - 可选插槽缺失时连同 `prefix`/`suffix` 一起消失（T1 §2.2 空槽规则）；
 * - `fallback`：缺失时的兜底文案（如收件人称呼，见 T1 §2.3）。
 */
export type LinePart =
  | { text: string }
  | {
      slot: string;
      required?: boolean;
      prefix?: string;
      suffix?: string;
      fallback?: string;
    };

/** 声明式模板块。 */
export type TemplateBlock =
  /** 姓名/信头行：16pt 黑体类，居左（T1 §2.2）。 */
  | { type: "heading"; slot: string }
  /** 联系行：9pt，空槽连同分隔符跳过；全部为空则整行省略。 */
  | { type: "contact"; slots: string[]; separator: string }
  /** 水平分隔线。 */
  | { type: "rule" }
  /** 区块标题：12pt 黑体类，段前 6pt。 */
  | { type: "section"; label: string }
  /** 内容行：正文 12pt，两端对齐；`hanging` 为经历条目悬挂缩进。 */
  | { type: "line"; parts: LinePart[]; hanging?: boolean }
  /** 书信正文段：两端对齐 + 首行缩进两字符。 */
  | { type: "para"; parts: LinePart[] }
  /** 渲染日期：YYYY 年 M 月 D 日（T1 §2.3 `{{today}}`）。 */
  | { type: "date" }
  /** 收件人行（第二行缩进对齐"收件："）。 */
  | { type: "recipient"; parts: LinePart[]; indent?: boolean }
  /** 结尾敬语两行（此致/敬礼）。 */
  | { type: "closing" };

/** 模板规格：标识 + 产物 DraftKind 映射 + 块列表。 */
export type TemplateSpec = {
  id: TemplateId;
  /**
   * 产物文件名的 kind 段（T1 §4.3：`{kind}-{opportunity_id}-v{version}.docx`）。
   * resume → `cv`（对齐现有 DraftKind）；cover-letter → `cover_letter`
   * （T1 §4.2 新增值：materials.kind 为 TEXT 列，直接扩值零迁移）。
   */
  kind: "cv" | "cover_letter";
  title: string;
  blocks: TemplateBlock[];
};
