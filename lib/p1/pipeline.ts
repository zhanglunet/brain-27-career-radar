import { getAdapter } from "./adapters.ts";
import { decideOpportunityChange, stableStringify } from "./decision.ts";
import type { CandidateDraft, OpportunityRow, SourceDocument } from "./types.ts";

export type P1Source = {
  id: string;
  name: string;
  url: string;
  source_type: "detail" | "listing" | "api" | "rss";
  adapter_key: string;
  auto_merge_low_risk: number;
};

export type P1PipelineSummary = {
  discoveredCount: number;
  evidenceCount: number;
  changeSetCount: number;
  appliedCount: number;
};

export async function processSourceDocument(
  db: D1Database,
  input: {
    source: P1Source;
    runId: string;
    snapshotId: string;
    html: string;
    finalUrl: string;
    capturedAt: string;
  },
): Promise<P1PipelineSummary> {
  const adapter = getAdapter(input.source.adapter_key);
  if (!adapter) throw new Error(`unknown P1 adapter: ${input.source.adapter_key}`);

  const document: SourceDocument = {
    sourceId: input.source.id,
    sourceName: input.source.name,
    sourceUrl: input.source.url,
    finalUrl: input.finalUrl,
    sourceType: input.source.source_type,
    adapterKey: input.source.adapter_key,
    html: input.html,
  };
  const candidates = adapter.extract(document).slice(0, 25);
  const summary: P1PipelineSummary = { discoveredCount: 0, evidenceCount: 0, changeSetCount: 0, appliedCount: 0 };

  for (const candidate of candidates) {
    const dedupeKey = await sha256(candidate.canonicalUrl);
    const existingCandidate = await db.prepare(
      "SELECT id FROM candidate_records WHERE dedupe_key = ?",
    ).bind(dedupeKey).first<{ id: string }>();
    const candidateId = existingCandidate?.id ?? `candidate-${dedupeKey.slice(0, 32)}`;

    await upsertCandidate(db, candidateId, dedupeKey, candidate, input);
    if (!existingCandidate) summary.discoveredCount += 1;
    summary.evidenceCount += await saveEvidence(db, candidateId, input.snapshotId, candidate);

    const opportunity = await findOpportunity(db, input.source, candidate);
    const decision = decideOpportunityChange(candidate, opportunity);
    if (!decision) continue;

    const patchJson = stableStringify(decision.patch as Record<string, unknown>);
    const patchHash = await sha256(patchJson);
    const changeSetId = `change-${(await sha256(`${candidateId}:${patchHash}`)).slice(0, 32)}`;
    const evidenceJson = JSON.stringify(candidate.evidence.map(({ fieldName, fieldValue, confidence }) => ({
      fieldName,
      fieldValue,
      confidence,
    })));
    const autoApply = decision.riskLevel === "low"
      && input.source.auto_merge_low_risk === 1
      && opportunity !== null;
    const status = autoApply ? "applied" : "pending";
    const inserted = await insertChangeSet(db, {
      id: changeSetId,
      candidateId,
      opportunityId: opportunity?.id ?? null,
      runId: input.runId,
      riskLevel: decision.riskLevel,
      status,
      patchJson,
      patchHash,
      evidenceJson,
      resolvedAt: autoApply ? input.capturedAt : null,
    });
    if (!inserted) continue;
    summary.changeSetCount += 1;

    if (autoApply && opportunity) {
      await applyLowRiskPatch(db, opportunity.id, decision.patch);
      await db.prepare("UPDATE candidate_records SET state = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(candidateId).run();
      summary.appliedCount += 1;
    } else {
      await db.prepare("UPDATE candidate_records SET state = 'review', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(candidateId).run();
      await db.prepare(
        `INSERT INTO review_queue (id, source_id, run_id, reason, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.source.id,
        input.runId,
        opportunity ? "parse_conflict" : "new_source",
        JSON.stringify({
          changeSetId,
          candidateId,
          riskLevel: decision.riskLevel,
          changedFields: decision.changedFields,
          canonicalUrl: candidate.canonicalUrl,
        }),
      ).run();
    }
  }

  return summary;
}

async function upsertCandidate(
  db: D1Database,
  candidateId: string,
  dedupeKey: string,
  candidate: CandidateDraft,
  input: Parameters<typeof processSourceDocument>[1],
) {
  await db.prepare(
    `INSERT INTO candidate_records
     (id, source_id, snapshot_id, canonical_url, dedupe_key, title, org, kind, location, deadline,
      opportunity_status, extracted_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       snapshot_id = excluded.snapshot_id,
       canonical_url = excluded.canonical_url,
       title = excluded.title,
       org = excluded.org,
       kind = excluded.kind,
       location = excluded.location,
       deadline = excluded.deadline,
       opportunity_status = excluded.opportunity_status,
       extracted_json = excluded.extracted_json,
       last_seen_at = excluded.last_seen_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    candidateId,
    input.source.id,
    input.snapshotId,
    candidate.canonicalUrl,
    dedupeKey,
    candidate.title,
    candidate.org,
    candidate.kind,
    candidate.location,
    candidate.deadline,
    candidate.status,
    JSON.stringify(candidate.metadata),
    input.capturedAt,
    input.capturedAt,
  ).run();
}

async function saveEvidence(
  db: D1Database,
  candidateId: string,
  snapshotId: string,
  candidate: CandidateDraft,
): Promise<number> {
  if (candidate.evidence.length === 0) return 0;
  const statements = candidate.evidence.map((item) => db.prepare(
    `INSERT INTO field_evidence
     (id, candidate_id, snapshot_id, field_name, field_value, excerpt, extractor, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id, snapshot_id, field_name, field_value) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    candidateId,
    snapshotId,
    item.fieldName,
    item.fieldValue,
    item.excerpt,
    item.extractor,
    item.confidence,
  ));
  const results = await db.batch(statements);
  return results.reduce((total, result) => total + result.meta.changes, 0);
}

async function findOpportunity(
  db: D1Database,
  source: P1Source,
  candidate: CandidateDraft,
): Promise<OpportunityRow | null> {
  const exact = await db.prepare(
    `SELECT id, name, org, kind, status, location, deadline, url
     FROM opportunities WHERE url = ? LIMIT 1`,
  ).bind(candidate.canonicalUrl).first<OpportunityRow>();
  if (exact) return exact;
  if (source.source_type !== "detail") return null;
  return db.prepare(
    `SELECT id, name, org, kind, status, location, deadline, url
     FROM opportunities WHERE source_id = ? LIMIT 1`,
  ).bind(source.id).first<OpportunityRow>();
}

async function insertChangeSet(
  db: D1Database,
  change: {
    id: string;
    candidateId: string;
    opportunityId: string | null;
    runId: string;
    riskLevel: "low" | "medium" | "high";
    status: "pending" | "applied";
    patchJson: string;
    patchHash: string;
    evidenceJson: string;
    resolvedAt: string | null;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO change_sets
     (id, candidate_id, opportunity_id, run_id, risk_level, status, patch_json, patch_hash, evidence_json, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id, patch_hash) DO NOTHING`,
  ).bind(
    change.id,
    change.candidateId,
    change.opportunityId,
    change.runId,
    change.riskLevel,
    change.status,
    change.patchJson,
    change.patchHash,
    change.evidenceJson,
    change.resolvedAt,
  ).run();
  return result.meta.changes > 0;
}

async function applyLowRiskPatch(db: D1Database, opportunityId: string, patch: { url?: string }) {
  if (!patch.url) return;
  await db.prepare("UPDATE opportunities SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(patch.url, opportunityId).run();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
