/** 简历元数据（文件本体在 R2）。按用户隔离。 */

export type Resume = { id: string; filename: string; mime: string; size: number; textChars: number | null; uploadedAt: number };

type ResumeRow = { id: string; filename: string; mime: string; size: number; text_chars: number | null; uploaded_at: number };

const toResume = (row: ResumeRow): Resume => ({
  id: row.id,
  filename: row.filename,
  mime: row.mime,
  size: row.size,
  textChars: row.text_chars,
  uploadedAt: row.uploaded_at,
});

const COLUMNS = "id, filename, mime, size, text_chars, uploaded_at";

export function resumeKey(userId: string, resumeId: string): string {
  return `${userId}/resumes/${resumeId}`;
}

export function resumesFor(db: D1Database, userId: string) {
  return {
    async list(): Promise<Resume[]> {
      const { results } = await db.prepare(`SELECT ${COLUMNS} FROM resumes WHERE user_id = ? ORDER BY uploaded_at, id`).bind(userId).all<ResumeRow>();
      return results.map(toResume);
    },
    async get(id: string): Promise<Resume | null> {
      const row = await db.prepare(`SELECT ${COLUMNS} FROM resumes WHERE id = ? AND user_id = ?`).bind(id, userId).first<ResumeRow>();
      return row ? toResume(row) : null;
    },
    async count(): Promise<number> {
      return (await db.prepare("SELECT COUNT(*) AS n FROM resumes WHERE user_id = ?").bind(userId).first<number>("n")) ?? 0;
    },
    async create(meta: { id: string; filename: string; mime: string; size: number }, now: number): Promise<Resume> {
      await db
        .prepare("INSERT INTO resumes (id, user_id, filename, mime, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(meta.id, userId, meta.filename, meta.mime, meta.size, now)
        .run();
      return { ...meta, textChars: null, uploadedAt: now };
    },
    async setTextChars(id: string, chars: number): Promise<void> {
      await db.prepare("UPDATE resumes SET text_chars = ? WHERE id = ? AND user_id = ?").bind(chars, id, userId).run();
    },
    async remove(id: string): Promise<boolean> {
      const result = await db.prepare("DELETE FROM resumes WHERE id = ? AND user_id = ?").bind(id, userId).run();
      return result.meta.changes === 1;
    },
  };
}
