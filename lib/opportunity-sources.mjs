// PRD-259/T2（trend #1296）：机会源能力层——来源注册 + 健康状态机 + doctor 最小实现。
//
// 按 PRD-259/T1 设计（docs/plans/2026-10-28-prd-259-opportunity-source-layer.md）实现 T2 范围：
//   opportunity-source-v1 注册表校验：auth 只许 "none"、data_class 只许 "public"、
//   tos_url 必填，违规条目拒载（逐条收集）；
//   健康四态：healthy→degraded（连续≥2 失败）→failed（连续≥5 或 403/404）；429 标
//   throttled（限流≠故障分列）；拉取记录带 source_id 可追溯；
//   doctor：人读表格 + JSON（per_source + summary）。
//
// T3 主备切换审计、T4 边界文档另任务。零网络：只消费调用方喂入的结果码（fixture 假源）；
// 不绕登录墙的代码路径不存在。示例全虚构。
export const SCHEMA = "opportunity-source-v1";

export const STATES = {
  HEALTHY: "healthy", DEGRADED: "degraded", FAILED: "failed", THROTTLED: "throttled",
};

export class SourceRejected extends Error {
  constructor(sourceId, reason) {
    super(`${sourceId}: ${reason}`);
    this.sourceId = sourceId;
    this.reason = reason;
  }
}

export function validateSource(entry) {
  const sid = entry.source_id || "<missing>";
  if (entry.schema !== SCHEMA) throw new SourceRejected(sid, `schema 必须为 ${SCHEMA}`);
  if (entry.auth !== "none") throw new SourceRejected(sid, "auth 必须为 none（不收需登录态的来源）");
  if (entry.data_class !== "public") throw new SourceRejected(sid, "data_class 必须为 public");
  const primary = entry.primary || {};
  if (!primary.tos_url) throw new SourceRejected(sid, "primary.tos_url 必填（ToS 声明硬要求）");
  if (!primary.url) throw new SourceRejected(sid, "primary.url 必填");
  if (!primary.rate_limit || typeof primary.rate_limit !== "object") {
    throw new SourceRejected(sid, "primary.rate_limit 必填（限流声明硬要求）");
  }
  (entry.standbys || []).forEach((sb, i) => {
    if (!sb.url || !sb.tos_url) throw new SourceRejected(sid, `standbys[${i}] 缺 url/tos_url`);
  });
  return entry;
}

export class OpportunityLayer {
  constructor(entries) {
    this._sources = new Map();
    this._health = new Map();
    for (const entry of entries) {
      validateSource(entry);
      this._sources.set(entry.source_id, entry);
      this._health.set(entry.source_id, {
        state: STATES.HEALTHY,
        consecutiveFailures: 0,
        lastErrorClass: null,
        standbyInUse: null,
        usedPerMin: 0,
        limitPerMin: entry.primary.rate_limit.requests_per_min ?? 0,
        pulls: [], // {source_id, fetched_at, ok}——拉取可追溯
      });
    }
  }

  ids() { return [...this._sources.keys()]; }

  recordResult(sourceId, status, { errorClass = null, standbyInUse = null, fetchedAt = null } = {}) {
    const h = this._health.get(sourceId);
    if (!h) throw new Error(`未注册来源: ${sourceId}`);
    if (status === "429") {
      h.lastErrorClass = "throttled";
      h.state = STATES.THROTTLED;
    } else if (status === "ok") {
      h.consecutiveFailures = 0;
      h.lastErrorClass = null;
      h.state = STATES.HEALTHY;
    } else {
      h.consecutiveFailures += 1;
      h.lastErrorClass = errorClass ?? { 403: "forbidden", 404: "gone" }[status] ?? "error";
      if (status === 403 || status === 404 || h.consecutiveFailures >= 5) {
        h.state = STATES.FAILED;
      } else if (h.consecutiveFailures >= 2) {
        h.state = STATES.DEGRADED;
      } else {
        h.state = STATES.HEALTHY;
      }
    }
    if (standbyInUse !== null) h.standbyInUse = standbyInUse;
    if (fetchedAt) h.pulls.push({ source_id: sourceId, fetched_at: fetchedAt, ok: status === "ok" });
    return h.state;
  }

  markUsed(sourceId, usedPerMin) {
    this._health.get(sourceId).usedPerMin = usedPerMin;
  }

  state(sourceId) { return this._health.get(sourceId).state; }

  doctorJson() {
    const perSource = [...this._sources.keys()].map((sid) => {
      const h = this._health.get(sid);
      return {
        source_id: sid,
        state: h.state,
        standby_in_use: h.standbyInUse,
        throttled: h.state === STATES.THROTTLED,
        rate: { used_per_min: h.usedPerMin, limit_per_min: h.limitPerMin },
        last_error_class: h.lastErrorClass,
        tos_url: this._sources.get(sid).primary.tos_url,
      };
    });
    return {
      schema: "doctor-report-v1",
      per_source: perSource,
      summary: {
        total: perSource.length,
        healthy: perSource.filter((s) => s.state === "healthy").length,
        degraded: perSource.filter((s) => s.state === "degraded").length,
        failed: perSource.filter((s) => s.state === "failed").length,
        throttled: perSource.filter((s) => s.state === "throttled").length,
      },
    };
  }

  doctorText() {
    const lines = ["source_id        state     standby  rate(used/limit)  last_error  tos"];
    for (const sid of this._sources.keys()) {
      const h = this._health.get(sid);
      lines.push(
        `${sid.padEnd(16)} ${h.state.padEnd(9)} ${String(h.standbyInUse ?? "-").padEnd(8)} ` +
        `${h.usedPerMin}/${h.limitPerMin}`.padEnd(17) + ` ${String(h.lastErrorClass ?? "-").padEnd(11)} ` +
        `${this._sources.get(sid).primary.tos_url}`,
      );
    }
    return lines.join("\n") + "\n";
  }
}

// 假源 fixture（测试用，零网络；example.com 占位）
export function exampleRegistry() {
  return [
    {
      schema: SCHEMA, source_id: "jobs-rss-example", kind: "rss",
      primary: { url: "https://jobs.example.com/rss", tos_url: "https://jobs.example.com/tos",
                  rate_limit: { requests_per_min: 6, burst: 3 } },
      standbys: [{ url: "https://mirror.example.com/jobs-rss", tos_url: "https://mirror.example.com/tos",
                    rate_limit: { requests_per_min: 6, burst: 3 } }],
      auth: "none", data_class: "public", enabled: true,
    },
    {
      schema: SCHEMA, source_id: "listing-page-example", kind: "public-page",
      primary: { url: "https://listing.example.com/public", tos_url: "https://listing.example.com/tos",
                  rate_limit: { requests_per_min: 4, burst: 2 } },
      standbys: [],
      auth: "none", data_class: "public", enabled: true,
    },
  ];
}
