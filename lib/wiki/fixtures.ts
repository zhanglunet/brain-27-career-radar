/**
 * PRD-017/T2 · 合成测试条目（fixtures）。
 *
 * 注意：全部为虚构数据，仅用于检索层自测与示例，绝不代表生产 D1 数据。
 * 生产数据只读；D1 行 → WikiEntry 的真实映射由 T5（trend #70）实现。
 */
import type { WikiEntry } from "./schema.ts";

export const FIXTURE_ENTRIES: WikiEntry[] = [
  {
    id: "wiki-ucl-phd-2027",
    title: "UCL 认知神经科学博士（2027 秋季入学）",
    source: "UCL 官网博士招生页",
    source_url: "https://www.ucl.ac.uk/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/ucl-phd-20261017",
    confidence: "high", // verdict=confirmed → high（review comment 1）
    created: "2026-10-17",
    last_verified: "2026-10-17",
    status: "active",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口", "认知神经科学"] },
    body: "UCL 2027 秋季认知神经科学博士招生，CSC 联合资助通道开放中。申请截止 2027-01-08，需提前联系导师。",
  },
  {
    id: "wiki-ucl-phd-pending",
    title: "UCL 认知神经科学博士项目（待核验）",
    source: "UCL 官网博士招生页",
    source_url: "https://www.ucl.ac.uk/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/ucl-phd-20261017",
    confidence: "medium", // verdict=pending → medium（review comment 1）
    created: "2026-10-17",
    last_verified: "2026-10-10",
    status: "active",
    facets: { type: "phd", region: "英国", funding: "tbd", keywords: ["认知神经科学"] },
    body: "UCL 认知神经科学博士项目，2027 秋季入学，资助方式待确认，信息待核验。",
  },
  {
    id: "wiki-cuhk-ra-2026",
    title: "港中文脑成像科研助理（RA）",
    source: "CUHK 医学院招聘页",
    source_url: "https://www.cuhk.edu.hk/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/cuhk-ra-20261017",
    confidence: "high",
    created: "2026-10-16",
    last_verified: "2026-10-16",
    status: "active",
    facets: { type: "ra", region: "中国香港", funding: "partial", keywords: ["脑成像", "fMRI"] },
    body: "香港中文大学医学院招聘脑成像方向科研助理，要求有 fMRI 数据处理经验，合同期 2 年，11 月底截止。",
  },
  {
    id: "wiki-ohbm-2027",
    title: "OHBM 2027 摘要投稿截止",
    source: "OHBM 官网",
    source_url: "https://www.humanbrainmapping.org/",
    source_type: "conference_calendar",
    d1_evidence: null, // 非 S1，证据可选
    confidence: "medium",
    created: "2026-10-17",
    last_verified: "2026-10-10",
    status: "active",
    facets: { keywords: ["conference", "脑成像", "摘要投稿"] },
    body: "OHBM 2027 年会摘要投稿截止日为 2027-01-15（预计，以官网为准）。脑科学方向最重要的年会之一。",
  },
  {
    id: "wiki-rumor-phd",
    title: "某英国高校脑机接口博士（传闻）",
    source: "论坛帖子",
    source_url: "https://example.test/forum/123",
    source_type: "manual",
    d1_evidence: null,
    confidence: "low", // verdict=rumor → low（review comment 1）；默认不进检索结果
    created: "2026-10-15",
    last_verified: "2026-10-15",
    status: "active",
    facets: { type: "phd", region: "英国", funding: "tbd", keywords: ["脑机接口"] },
    body: "论坛传闻某英国高校将开脑机接口博士项目，未经证实，仅供参考。",
  },
  {
    id: "wiki-expired-campus",
    title: "2026 秋季校招脑科学专场（已过期）",
    source: "校招官网",
    source_url: "https://example.test/campus",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/campus-2026",
    confidence: "high",
    created: "2026-08-01",
    last_verified: "2026-09-01",
    status: "expired", // 默认检索过滤，保留可追溯
    facets: { type: "campus", region: "中国大陆", funding: "full", keywords: ["校招"] },
    body: "2026 秋季校招脑科学专场，已于 9 月结束，仅保留追溯。",
  },
  {
    id: "wiki-merged-dup",
    title: "UCL 认知神经科学博士（重复条目，已合并）",
    source: "UCL 官网博士招生页",
    source_url: "https://www.ucl.ac.uk/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/ucl-phd-20261017",
    confidence: "medium",
    created: "2026-10-17",
    last_verified: "2026-10-17",
    status: "merged", // 去重指针，不进检索
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["认知神经科学"] },
    body: "与 wiki-ucl-phd-2027 重复，已合并去重，保留合并链追溯。",
  },
];
