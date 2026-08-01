type CountRow = {
  total: number;
  enabled?: number;
  ever_succeeded?: number;
  currently_failing?: number;
};

type LatestRunRow = {
  id: string;
  trigger: "cron" | "manual" | "test";
  status: "running" | "succeeded" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  checked_count: number;
  changed_count: number;
  failed_count: number;
};

const SCHEDULE = "0 1 * * *";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");

    const [sourceStats, opportunityStats, institutionStats, reviewStats, snapshotStats, latestRun] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
                SUM(CASE WHEN last_success_at IS NOT NULL THEN 1 ELSE 0 END) AS ever_succeeded,
                SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END) AS currently_failing
         FROM sources`,
      ).first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM opportunities WHERE published = 1").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM institutions WHERE published = 1").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM review_queue WHERE status = 'pending'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM source_snapshots").first<CountRow>(),
      env.DB.prepare(
        `SELECT id, trigger, status, started_at, finished_at, checked_count, changed_count, failed_count
         FROM sync_runs ORDER BY started_at DESC LIMIT 1`,
      ).first<LatestRunRow>(),
    ]);

    const generatedAt = new Date();
    const nextScheduledAt = nextDailyUtcHour(generatedAt, 1).toISOString();

    return Response.json({
      generatedAt: generatedAt.toISOString(),
      database: {
        configured: true,
        sources: number(sourceStats?.total),
        enabledSources: number(sourceStats?.enabled),
        opportunities: number(opportunityStats?.total),
        institutions: number(institutionStats?.total),
        snapshots: number(snapshotStats?.total),
        pendingReviews: number(reviewStats?.total),
      },
      automation: {
        configured: true,
        schedule: SCHEDULE,
        scheduleLabel: "每日 01:00 UTC / 日本时间 10:00",
        nextScheduledAt,
        checkedSources: number(sourceStats?.ever_succeeded),
        failingSources: number(sourceStats?.currently_failing),
        latestRun: latestRun ?? null,
      },
      capability: {
        sourceMonitoring: true,
        changeDetection: true,
        automaticContentPublishing: false,
        automaticSourceDiscovery: false,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.system_status.failed", error: errorMessage(error) }));
    return Response.json({
      generatedAt: new Date().toISOString(),
      database: { configured: false },
      automation: { configured: false, schedule: SCHEDULE },
      error: "system status is temporarily unavailable",
    }, { status: 503 });
  }
}

function nextDailyUtcHour(now: Date, hour: number): Date {
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function number(value: number | undefined | null): number {
  return Number(value ?? 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
