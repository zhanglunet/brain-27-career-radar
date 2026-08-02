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

const SCHEDULE = "0 1,7,13,19 * * *";

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");

    const [sourceStats, opportunityStats, institutionStats, reviewStats, observationStats, autoResolvedStats, priorityStats, snapshotStats, checkLogStats, candidateStats, evidenceStats, changeSetStats, pilotStats, researcherStats, paperStats, academicCandidateStats, academicRunStats, paperProviderStats, activePaperProviderStats, organizationFeedStats, organizationCandidateStats, latestRun] = await Promise.all([
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
      env.DB.prepare("SELECT COUNT(*) AS total FROM review_queue WHERE status = 'observing' AND review_mode = 'automatic'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM review_queue WHERE status IN ('approved','rejected') AND resolved_by = 'automatic-policy-v1'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM sources WHERE enabled = 1 AND priority IN ('critical','high')").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM source_snapshots").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM source_check_logs").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM candidate_records").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM field_evidence").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM change_sets WHERE status = 'pending'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM sources WHERE enabled = 1 AND discovery_enabled = 1 AND adapter_key IS NOT NULL").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM researchers WHERE published = 1").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM papers WHERE review_status = 'verified'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM papers WHERE review_status = 'candidate'").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM academic_sync_runs").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM paper_providers").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM paper_providers WHERE enabled = 1 AND discovery_enabled = 1").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM organization_discovery_feeds WHERE enabled = 1").first<CountRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM organization_candidates WHERE status = 'candidate'").first<CountRow>(),
      env.DB.prepare(
        `SELECT id, trigger, status, started_at, finished_at, checked_count, changed_count, failed_count
         FROM sync_runs ORDER BY started_at DESC LIMIT 1`,
      ).first<LatestRunRow>(),
    ]);

    const generatedAt = new Date();
    const nextScheduledAt = nextScheduledUtcHour(generatedAt, [1, 7, 13, 19]).toISOString();

    return Response.json({
      generatedAt: generatedAt.toISOString(),
      database: {
        configured: true,
        sources: number(sourceStats?.total),
        enabledSources: number(sourceStats?.enabled),
        opportunities: number(opportunityStats?.total),
        institutions: number(institutionStats?.total),
        snapshots: number(snapshotStats?.total),
        sourceCheckLogs: number(checkLogStats?.total),
        pendingReviews: number(reviewStats?.total),
        automaticObservations: number(observationStats?.total),
        automaticallyResolved: number(autoResolvedStats?.total),
        prioritySources: number(priorityStats?.total),
        candidates: number(candidateStats?.total),
        fieldEvidence: number(evidenceStats?.total),
        pendingChangeSets: number(changeSetStats?.total),
        pilotSources: number(pilotStats?.total),
        researchers: number(researcherStats?.total),
        verifiedPapers: number(paperStats?.total),
        paperCandidates: number(academicCandidateStats?.total),
        academicSyncRuns: number(academicRunStats?.total),
        paperProviders: number(paperProviderStats?.total),
        activePaperProviders: number(activePaperProviderStats?.total),
        organizationDiscoveryFeeds: number(organizationFeedStats?.total),
        organizationCandidates: number(organizationCandidateStats?.total),
      },
      automation: {
        configured: true,
        schedule: SCHEDULE,
        scheduleLabel: "每 6 小时触发；普通来源每日、重点来源每 6 小时",
        nextScheduledAt,
        checkedSources: number(sourceStats?.ever_succeeded),
        failingSources: number(sourceStats?.currently_failing),
        latestRun: latestRun ?? null,
      },
      capability: {
        sourceMonitoring: true,
        changeDetection: true,
        structuredExtraction: true,
        sameSiteCandidateDiscovery: true,
        automaticContentPublishing: false,
        automaticReview: true,
        automaticExternalSourceApproval: false,
        organizationDiscovery: true,
        researcherMonitoring: true,
        paperDiscovery: true,
        automaticPaperVerification: false,
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

function nextScheduledUtcHour(now: Date, hours: number[]): Date {
  for (const hour of hours) {
    const candidate = new Date(now);
    candidate.setUTCHours(hour, 0, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(hours[0] ?? 1, 0, 0, 0);
  return next;
}

function number(value: number | undefined | null): number {
  return Number(value ?? 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
