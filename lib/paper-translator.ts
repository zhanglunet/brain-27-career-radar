const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
const MAX_PAPERS_PER_RUN = 6;
const MAX_ABSTRACT_CHARACTERS = 3_600;

type TranslationAi = {
  run(model: string, input: { text: string; source_lang: string; target_lang: string }): Promise<unknown>;
};

type PendingPaper = {
  id: string;
  title: string;
  abstract: string;
};

export type TranslationSummary = {
  checked: number;
  translated: number;
  failed: number;
};

export async function translatePendingPapers(
  db: D1Database,
  ai: TranslationAi,
  options: { limit?: number; now?: () => Date } = {},
): Promise<TranslationSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_PAPERS_PER_RUN, 20));
  const now = options.now ?? (() => new Date());
  const pending = await db.prepare(
    `SELECT id, title, abstract FROM papers
     WHERE review_status != 'rejected' AND translation_status IN ('pending', 'failed')
     ORDER BY CASE translation_status WHEN 'pending' THEN 0 ELSE 1 END, COALESCE(publication_date, created_at) DESC
     LIMIT ?`,
  ).bind(limit).all<PendingPaper>();

  let translated = 0;
  let failed = 0;
  for (const paper of pending.results) {
    try {
      const titleZh = await translatePaperText(ai, paper.title);
      const abstractZh = paper.abstract.trim()
        ? await translatePaperText(ai, paper.abstract.slice(0, MAX_ABSTRACT_CHARACTERS))
        : "";
      await db.prepare(
        `UPDATE papers SET title_zh = ?, abstract_zh = ?, translation_status = 'completed',
         translated_at = ?, translation_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(titleZh, abstractZh, now().toISOString(), paper.id).run();
      translated += 1;
    } catch (error) {
      const message = errorMessage(error);
      await db.prepare(
        `UPDATE papers SET translation_status = 'failed', translation_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(message, paper.id).run();
      failed += 1;
      console.error(JSON.stringify({ event: "radar.paper_translation.failed", paperId: paper.id, error: message }));
    }
  }

  const summary = { checked: pending.results.length, translated, failed };
  console.log(JSON.stringify({ event: "radar.paper_translation.finished", ...summary, model: TRANSLATION_MODEL, finishedAt: now().toISOString() }));
  return summary;
}

export async function translatePaperText(ai: TranslationAi, text: string): Promise<string> {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return "";
  if (/^[\p{Script=Han}\p{P}\p{N}\p{Zs}]+$/u.test(source)) return source;
  const response = await ai.run(TRANSLATION_MODEL, { text: source, source_lang: "en", target_lang: "zh" });
  const translated = isRecord(response) && typeof response.translated_text === "string"
    ? response.translated_text.replace(/\s+/g, " ").trim()
    : "";
  if (!translated) throw new Error("Workers AI returned an empty translation");
  return translated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
