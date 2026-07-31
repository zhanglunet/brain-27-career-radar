import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { institutions, opportunities, syncRuns } from "../../../db/schema";

export async function GET() {
  try {
    const db = await getDb();
    const [opportunityRows, institutionRows, latestRuns] = await Promise.all([
      db.select().from(opportunities).where(eq(opportunities.published, true)).orderBy(asc(opportunities.createdAt)),
      db.select().from(institutions).where(eq(institutions.published, true)).orderBy(asc(institutions.sortOrder)),
      db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
    ]);

    if (opportunityRows.length === 0) {
      return Response.json({ error: "radar database has no published opportunities" }, { status: 503 });
    }

    const latestRun = latestRuns[0] ?? null;
    const updatedAt = latestRun?.finishedAt
      ?? opportunityRows.map((item) => item.sourceVerifiedAt ?? item.updatedAt).sort().at(-1)
      ?? null;

    return Response.json({
      dataOrigin: "database",
      updatedAt,
      syncStatus: latestRun?.status ?? "not_run",
      opportunities: opportunityRows.map(({ tagsJson, ...item }) => ({
        ...item,
        tags: parseTags(tagsJson),
      })),
      institutions: institutionRows,
    }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.api.failed", error: errorMessage(error) }));
    return Response.json({ error: "radar database is temporarily unavailable" }, { status: 503 });
  }
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
