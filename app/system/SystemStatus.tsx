"use client";

import { useEffect, useState } from "react";
import styles from "../documentation.module.css";

type SystemStatusPayload = {
  generatedAt: string;
  database: {
    configured: boolean;
    sources?: number;
    enabledSources?: number;
    opportunities?: number;
    institutions?: number;
    snapshots?: number;
    pendingReviews?: number;
  };
  automation: {
    configured: boolean;
    schedule: string;
    scheduleLabel?: string;
    nextScheduledAt?: string;
    checkedSources?: number;
    failingSources?: number;
    latestRun?: {
      id: string;
      trigger: string;
      status: "running" | "succeeded" | "partial" | "failed";
      started_at: string;
      finished_at: string | null;
      checked_count: number;
      changed_count: number;
      failed_count: number;
    } | null;
  };
};

export default function SystemStatus() {
  const [status, setStatus] = useState<SystemStatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/system-status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status API returned ${response.status}`);
        return response.json() as Promise<SystemStatusPayload>;
      })
      .then(setStatus)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) return <div className={styles.loading}>实时状态暂时不可用；机会雷达仍会使用最后一次可信数据。</div>;
  if (!status) return <div className={styles.loading}>正在读取 Cloudflare D1 实时状态…</div>;

  const latest = status.automation.latestRun;
  const state = latest?.status ?? "waiting";
  const stateLabel = latest ? runStatusLabel(latest.status) : "已配置，等待首次定时运行";
  const stateClass = state === "failed"
    ? `${styles.state} ${styles.stateError}`
    : state === "partial" || state === "waiting"
      ? `${styles.state} ${styles.stateWarning}`
      : styles.state;

  return <div>
    <div className={stateClass}>{stateLabel}</div>
    <div className={styles.statusGrid}>
      <article className={styles.statusCard}><span>D1 数据库</span><strong>{status.database.configured ? "正常" : "异常"}</strong><p>{status.database.sources ?? 0} 个来源，{status.database.opportunities ?? 0} 个公开机会</p></article>
      <article className={styles.statusCard}><span>已成功巡检来源</span><strong>{status.automation.checkedSources ?? 0}/{status.database.enabledSources ?? 0}</strong><p>当前失败来源 {status.automation.failingSources ?? 0} 个</p></article>
      <article className={styles.statusCard}><span>来源快照</span><strong>{status.database.snapshots ?? 0}</strong><p>待人工审核 {status.database.pendingReviews ?? 0} 项</p></article>
      <article className={styles.statusCard}><span>下次自动运行</span><strong>{formatTime(status.automation.nextScheduledAt)}</strong><p>{status.automation.scheduleLabel ?? status.automation.schedule}</p></article>
    </div>
    {latest ? <p className={styles.note}>最近一次运行：{formatDateTime(latest.finished_at ?? latest.started_at)}，触发方式 {latest.trigger}；检查 {latest.checked_count} 个来源，发现变化 {latest.changed_count} 个，失败 {latest.failed_count} 个。</p> : <p className={styles.note}>生产库尚无巡检记录。Cron 已部署，但需要等到首个计划时刻执行后，才能从 D1 历史记录证明生产定时任务已实际触发。</p>}
  </div>;
}

function runStatusLabel(status: "running" | "succeeded" | "partial" | "failed"): string {
  if (status === "succeeded") return "最近一次巡检成功";
  if (status === "partial") return "最近一次巡检部分成功";
  if (status === "failed") return "最近一次巡检失败";
  return "巡检正在运行";
}

function formatTime(value?: string): string {
  if (!value) return "待计算";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
