/**
 * PRD-150/T2 · 本地 .docx 渲染引擎（resume / cover-letter 两模板，T1 §2）。
 *
 * 借鉴 genspark-ai/genoffice（Apache-2.0）「本地生成、数据不出本机」形态思路；
 * 本实现为自研表述，未复制其代码。
 *
 * ── 数据主权红线（T1 §五）──────────────────────────────────────
 * 1. 渲染路径无网络请求：本模块（及 templates/、profile.ts、placeholder.ts）
 *    不出现任何 fetch / HTTP import；唯一的第三方依赖 `docx` 是纯本地
 *    TypeScript 生成库（T1 §2.1 选型：纯本地生成、无网络依赖、TS 可用）；
 * 2. 无日志（无 console.*）：占位符残留以 warnings 返回，由调用方打印；
 * 3. 无发送能力：产物只是本地文件，无 upload/send/submit 语义
 *    （PRD-080 非目标「不自动投递」延续）；
 * 4. 文件名带版本（T1 §4.3）：`{kind}-{opportunityId}-v{version}.docx`，
 *    只读消费 materials 草稿，不回写。
 *
 * 约定：只用可擦除 TypeScript 语法（无 enum / namespace），`node --test`
 * 可直接运行。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LineRuleType,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { OpportunityInput } from "../drafter.ts";
import { AI_DRAFT_MARKER } from "../drafter.ts";
import type { JobDocProfile, JobDocBasics, JobDocEducation } from "./profile.ts";
import { outputLabel, skillsLine } from "./profile.ts";
import { placeholder } from "./placeholder.ts";
import type { LinePart, TemplateBlock, TemplateSpec } from "./templates/types.ts";
import { resumeTemplate } from "./templates/resume.ts";
import { coverLetterTemplate } from "./templates/cover-letter.ts";

// ── 中文排版常量（T1 §2.4）────────────────────────────────────

/** 字体回退栈：不内嵌字体文件，打开方本机回退（避免字体版权问题）。 */
const FONT_HEI = { ascii: "Arial", eastAsia: "黑体", hAnsi: "Arial" } as const;
const FONT_SONG = {
  ascii: "Times New Roman",
  eastAsia: "宋体",
  hAnsi: "Times New Roman",
} as const;

/** 字号（半磅）：姓名 16pt / 区块标题 12pt / 正文 12pt / 联系行与页脚 9pt。 */
const SIZE_NAME = 32;
const SIZE_SECTION = 24;
const SIZE_BODY = 24;
const SIZE_SMALL = 18;

/** A4（twips）与页边距：上下 2.0cm / 左右 2.2cm。 */
const PAGE_A4 = { width: 11906, height: 16838 } as const;
const MARGIN_CM20 = 1134;
const MARGIN_CM22 = 1247;

/** 正文 1.3 倍行距（240 × 1.3 = 312）；区块间段前 6pt = 120 twips。 */
const LINE_130 = { line: 312, lineRule: LineRuleType.AUTO } as const;
const BEFORE_SECTION = 120;

/** 12pt 下一个全角字符 ≈ 240 twips：悬挂缩进 1 字、首行缩进 2 字、收件对齐 3 字。 */
const INDENT_ONE_CHAR = 240;
const INDENT_TWO_CHARS = 480;
const INDENT_THREE_CHARS = 720;

// ── 插槽解析 ──────────────────────────────────────────────────

type RenderContext = {
  profile: JobDocProfile;
  opportunity?: OpportunityInput;
  now: Date;
  letterBody?: string;
};

/** 渲染日期：YYYY 年 M 月 D 日（T1 §2.3 `{{today}}`）。 */
export function formatCnDate(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/**
 * 匹配段正文预处理：剥掉 Markdown 草稿头部的 `> ⚠️` 标注块
 * （drafter.ts MARKER_BLOCK 语法在 docx 里不复用；docx 的标注段由本
 * 模块按 T1 §3.3 强制重写为独立样式段，双保险见 T1 §4.5）。
 */
function stripMarkdownMarkerBlock(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim().startsWith(">")) i += 1;
  return lines.slice(i).join("\n").trim();
}

/** 字段路径 → 展示文本；复合路径（skills / outputs[i] / target.*）按 T1 拼接。 */
function resolveSlot(path: string, ctx: RenderContext): string {
  const { profile, opportunity, letterBody } = ctx;
  if (path.startsWith("basics.")) {
    const key = path.slice(7) as keyof JobDocBasics;
    return profile.basics?.[key] ?? "";
  }
  let m = /^education\[(\d+)\]\.(degree|school|period|note)$/.exec(path);
  if (m) {
    const key = m[2] as keyof JobDocEducation;
    return profile.education?.[Number(m[1])]?.[key] ?? "";
  }
  m = /^experience\[(\d+)\]\.(title|org|period|highlight)$/.exec(path);
  if (m) {
    const key = m[2] as "title" | "org" | "period" | "highlight";
    return profile.experience?.[Number(m[1])]?.[key] ?? "";
  }
  m = /^outputs\[(\d+)\]$/.exec(path);
  if (m) {
    const output = profile.outputs?.[Number(m[1])];
    return output ? outputLabel(output) : "";
  }
  if (path === "skills") return skillsLine(profile.skills);
  if (path === "education" || path === "experience") {
    // 复合空档：仅当区块整体为空时模板才引用，必选 → 占位符。
    return "";
  }
  if (path === "target.researchInterests") {
    return profile.target?.researchInterests?.join("、") ?? "";
  }
  if (path === "today") return formatCnDate(ctx.now);
  if (path === "letter.body") return letterBody ?? "";
  if (path.startsWith("opportunity.")) {
    const field = path.slice("opportunity.".length);
    if (!opportunity) return "";
    if (field === "mentor") return opportunity.mentors?.[0] ?? "";
    if (field === "title") return opportunity.title;
    if (field === "org") return opportunity.org;
    if (field === "type") return opportunity.type;
    if (field === "region") return opportunity.region ?? "";
    if (field === "deadline") return opportunity.deadline ?? "";
  }
  return "";
}

/** 占位符登记簿：渲染中收集 `[待填写：路径]` 残留，随结果返回。 */
class PlaceholderSink {
  readonly paths: string[] = [];
  add(path: string): void {
    if (!this.paths.includes(path)) this.paths.push(path);
  }
  get warnings(): string[] {
    return this.paths.map((p) => `缺少字段 ${p}，已留 ${placeholder(p)}，请人工补填后再导出终稿`);
  }
}

/**
 * 行装配（T1 §2.2 空槽规则）：
 * - 有值 → prefix + 值 + suffix；
 * - 缺失必选 → 占位符入文并登记（渲染不中断）；
 * - 缺失可选但有 fallback → prefix + 兜底 + suffix；
 * - 缺失可选 → 连同 prefix/suffix 一起消失，不留痕。
 */
function assembleLine(
  parts: readonly LinePart[],
  ctx: RenderContext,
  sink: PlaceholderSink,
): string {
  let out = "";
  for (const part of parts) {
    if ("text" in part) {
      out += part.text;
      continue;
    }
    const value = resolveSlot(part.slot, ctx).trim();
    if (value.length > 0) {
      out += (part.prefix ?? "") + value + (part.suffix ?? "");
    } else if (part.required) {
      out += placeholder(part.slot);
      sink.add(part.slot);
    } else if (part.fallback !== undefined) {
      out += (part.prefix ?? "") + part.fallback + (part.suffix ?? "");
    }
  }
  return out;
}

// ── 模板块 → docx 段落 ────────────────────────────────────────

function markerParagraph(): Paragraph {
  // T1 §3.3：AI 标注渲染为文档首行独立标注段（斜体、9pt、灰色，
  // 样式名 ai-draft-marker）；非 final 导出强制携带。
  const text =
    `⚠️ ${AI_DRAFT_MARKER}：本文件由本地模板渲染生成（全程本地，数据未出本机），` +
    "未经人工审阅不得直接投递。";
  return new Paragraph({
    style: "ai-draft-marker",
    children: [new TextRun(text)],
  });
}

function ruleParagraph(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
    },
    spacing: { after: 80 },
    children: [],
  });
}

function blockToParagraphs(
  block: TemplateBlock,
  ctx: RenderContext,
  sink: PlaceholderSink,
): Paragraph[] {
  switch (block.type) {
    case "heading": {
      const value = resolveSlot(block.slot, ctx).trim();
      const text = value.length > 0 ? value : placeholder(block.slot);
      if (value.length === 0) sink.add(block.slot);
      return [new Paragraph({ style: "JobDocHeading", children: [new TextRun(text)] })];
    }
    case "contact": {
      const present = block.slots
        .map((slot) => resolveSlot(slot, ctx).trim())
        .filter((v) => v.length > 0);
      if (present.length === 0) return []; // 全空 → 整行省略（可选规则）
      return [
        new Paragraph({
          style: "JobDocContact",
          children: [new TextRun(present.join(block.separator))],
        }),
      ];
    }
    case "rule":
      return [ruleParagraph()];
    case "section":
      return [
        new Paragraph({
          style: "JobDocSection",
          children: [new TextRun(block.label)],
        }),
      ];
    case "line": {
      const text = assembleLine(block.parts, ctx, sink);
      return [
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: LINE_130,
          indent: block.hanging
            ? { left: INDENT_ONE_CHAR, hanging: INDENT_ONE_CHAR }
            : undefined,
          children: text.length > 0 ? [new TextRun({ size: SIZE_BODY, text })] : [],
        }),
      ];
    }
    case "para": {
      const text = assembleLine(block.parts, ctx, sink);
      return [
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: LINE_130,
          indent: { firstLine: INDENT_TWO_CHARS },
          children: text.length > 0 ? [new TextRun({ size: SIZE_BODY, text })] : [],
        }),
      ];
    }
    case "date":
      return [
        new Paragraph({
          spacing: { ...LINE_130, before: BEFORE_SECTION },
          children: [new TextRun({ size: SIZE_BODY, text: formatCnDate(ctx.now) })],
        }),
      ];
    case "recipient": {
      const text = assembleLine(block.parts, ctx, sink);
      return [
        new Paragraph({
          spacing: LINE_130,
          indent: block.indent ? { left: INDENT_THREE_CHARS } : undefined,
          children: [new TextRun({ size: SIZE_BODY, text })],
        }),
      ];
    }
    case "closing":
      return [
        new Paragraph({
          spacing: { ...LINE_130, before: BEFORE_SECTION },
          indent: { firstLine: INDENT_TWO_CHARS },
          children: [new TextRun({ size: SIZE_BODY, text: "此致" })],
        }),
        new Paragraph({
          spacing: LINE_130,
          indent: { firstLine: INDENT_TWO_CHARS },
          children: [new TextRun({ size: SIZE_BODY, text: "敬礼" })],
        }),
      ];
  }
}

// ── 对外 API ──────────────────────────────────────────────────

export type RenderDocxOptions = {
  /** 模板标识（T1 §2.1 两套模板）。 */
  template: "resume" | "cover-letter";
  /** 机会 ID：进文件名（与 materials/opportunity_cache 对齐；无机会场景可用 "general"）。 */
  opportunityId: string;
  /** 版本号（materials.version 语义，从 1 递增）。 */
  version: number;
  /** 统一档案（JobDocProfile；老档案先用 parseJobDocProfile 归一）。 */
  profile: JobDocProfile;
  /** 机会输入（公开情报；cover-letter 信头/来意段用）。 */
  opportunity?: OpportunityInput;
  /** 求职信匹配段草稿（materials 最新 ps / cover_letter；只读消费）。 */
  letterDraft?: string;
  /** true = 人工定稿版（无 AI 标注段）；缺省 false，非 final 强制带标注（T1 §3.3）。 */
  final?: boolean;
  /** 时间源（可注入，便于测试）。 */
  now?: Date;
};

export type RenderResult = {
  template: "resume" | "cover-letter";
  /** 产物 kind 段：resume → cv；cover-letter → cover_letter（T1 §4.2/§4.3）。 */
  kind: "cv" | "cover_letter";
  /** `{kind}-{opportunityId}-v{version}.docx` */
  filename: string;
  /** .docx 文件字节（调用方落盘，本函数不写磁盘）。 */
  bytes: Buffer;
  /** 占位符残留的字段路径（T1 §3.2：调用方须醒目警告）。 */
  placeholders: string[];
  /** 每处残留一条警告文案（供 CLI 直接打印）。 */
  warnings: string[];
};

function buildTemplate(options: RenderDocxOptions): TemplateSpec {
  if (options.template === "resume") return resumeTemplate(options.profile);
  return coverLetterTemplate(options.profile, options.opportunity);
}

/**
 * 渲染 JobDocProfile 为真实 .docx 字节（resume / cover-letter）。
 * 纯本地计算：模板 + 档案 + 本地草稿 → 字节，全程无网络。
 */
export async function renderJobDoc(options: RenderDocxOptions): Promise<RenderResult> {
  const ctx: RenderContext = {
    profile: options.profile,
    opportunity: options.opportunity,
    now: options.now ?? new Date(),
    letterBody:
      options.letterDraft !== undefined
        ? stripMarkdownMarkerBlock(options.letterDraft)
        : undefined,
  };
  const spec = buildTemplate(options);
  const sink = new PlaceholderSink();

  const children: Paragraph[] = [];
  if (options.final !== true) children.push(markerParagraph());
  for (const block of spec.blocks) {
    children.push(...blockToParagraphs(block, ctx, sink));
  }

  const doc = new Document({
    creator: "brain27 本地生成（PRD-150，数据未出本机）",
    title: spec.title,
    description: "本地模板渲染；渲染路径无网络请求。",
    styles: {
      default: {
        document: {
          run: { font: { ...FONT_SONG }, size: SIZE_BODY },
          paragraph: { spacing: LINE_130 },
        },
      },
      paragraphStyles: [
        {
          id: "JobDocHeading",
          name: "JobDoc Heading",
          basedOn: "Normal",
          next: "Normal",
          run: { font: { ...FONT_HEI }, size: SIZE_NAME },
          paragraph: { spacing: { after: 80, ...LINE_130 } },
        },
        {
          id: "JobDocSection",
          name: "JobDoc Section",
          basedOn: "Normal",
          next: "Normal",
          run: { font: { ...FONT_HEI }, size: SIZE_SECTION },
          paragraph: { spacing: { before: BEFORE_SECTION, after: 60, ...LINE_130 } },
        },
        {
          id: "JobDocContact",
          name: "JobDoc Contact",
          basedOn: "Normal",
          next: "Normal",
          run: { font: { ...FONT_SONG }, size: SIZE_SMALL },
          paragraph: { spacing: { ...LINE_130, after: 40 } },
        },
        {
          id: "ai-draft-marker",
          name: "ai-draft-marker",
          basedOn: "Normal",
          next: "Normal",
          run: { font: { ...FONT_SONG }, italics: true, color: "808080", size: SIZE_SMALL },
          paragraph: { spacing: { after: 120 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { ...PAGE_A4 },
            margin: {
              top: MARGIN_CM20,
              bottom: MARGIN_CM20,
              left: MARGIN_CM22,
              right: MARGIN_CM22,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    size: SIZE_SMALL,
                    children: ["页 ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const bytes = await Packer.toBuffer(doc);
  return {
    template: spec.id,
    kind: spec.kind,
    filename: `${spec.kind}-${options.opportunityId}-v${options.version}.docx`,
    bytes,
    placeholders: sink.paths,
    warnings: sink.warnings,
  };
}

/**
 * 把渲染结果写入本地目录（唯一的磁盘写入口；建目录 + 落盘，返回完整路径）。
 * 文件仅在本机，无任何上传通道。
 */
export async function writeRenderedDoc(result: RenderResult, outDir: string): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, result.filename);
  await writeFile(outPath, result.bytes);
  return outPath;
}
