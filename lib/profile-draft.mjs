// PRD-281/T2: 求职档案改动草稿 + 回滚最小实现（profile-draft-v1）。
//
// T1 设计：docs/plans/2026-10-29-prd-281-profile-draft-rollback.md
// （trend issue #1407）。本模块为 T2 最小切片：纯 ESM、仅 node:crypto 一个
// 标准库依赖、零网络、零 IO——落盘（temp+rename、0700/0600）与审计表在后续任务接线。
//
// 语义（与 T1 §3.1/§3.3 对齐的最小化）：
// - makeDraft(currentDoc, changes, {targetFingerprint, takenAt}) → profile-draft-v1
//   草稿存 diff 形态（RFC 6901 JSON Pointer [{op:"replace", path, value}]），不存整文件副本，
//   防双写漂移；target_fingerprint 是目标对象整文件指纹（缺省按 currentDoc 现算）。
// - confirmDraft(draft, currentDoc)：生效前指纹重验——currentDoc 指纹 ≠ target_fingerprint
//   即 confirm_conflict 拒绝（手改与草稿并发时不静默合并）；生效原子完成（先克隆后改，
//   任一步失败 currentDoc 原对象分毫不动），返回 {applied:true, newDoc}，上一版自动
//   保留在 newDoc.prev（单槽链）。
// - rollbackToPrev(doc)：doc 含 prev 时回到上一版（回滚可再回滚——prev 链自带）；
//   无 prev → {restored:false, reason:"rollback_refused"}，不抛不吞。
//
// 红线：
// - confirm ≠ 外发：本模块零投递/零发送/零上传依赖，投递动作仍走 PRD-175 批准门
//   （ACTION_REGISTRY 四项不增删，T4 结构断言）；回滚一律人工触发，无自动路径。
// - 指纹可外留，字段值正文不留：审计/日志只应引用 fingerprint 与 pointer，不应引用 value。
// - 示例全虚构（example.com 保留域、占位姓名），无真实主机名/IP/账号/密钥。

import { createHash } from "node:crypto";

export const PROFILE_DRAFT_SCHEMA = "profile-draft-v1";

/** 递归键排序 → canonical JSON（确定性序列化，键序无关）。 */
function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/** 目标对象整文件指纹：sha256(canonical json) 全长 64 位十六进制。 */
export function fingerprintDoc(doc) {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

function deepClone(value) {
  return structuredClone(value);
}

// --- RFC 6901 JSON Pointer ---------------------------------------------------

function parsePointer(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new Error(`非法 JSON Pointer（须以 / 开头）：${String(pointer)}`);
  }
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => seg.replaceAll("~1", "/").replaceAll("~0", "~"));
}

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

function descend(node, token, pointer) {
  if (Array.isArray(node)) {
    if (!ARRAY_INDEX.test(token)) {
      throw new Error(`非法数组下标：${pointer}`);
    }
    const idx = Number(token);
    if (idx >= node.length) throw new Error(`路径不存在：${pointer}`);
    return node[idx];
  }
  if (node !== null && typeof node === "object" && Object.hasOwn(node, token)) {
    return node[token];
  }
  throw new Error(`路径不存在：${pointer}`);
}

/** replace 语义：路径必须已存在；返回全新 doc，输入分毫不动（原子前提）。 */
function replaceAt(doc, pointer, value) {
  const tokens = parsePointer(pointer);
  const root = deepClone(doc);
  let node = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    node = descend(node, tokens[i], pointer);
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(node)) {
    if (!ARRAY_INDEX.test(last)) throw new Error(`非法数组下标：${pointer}`);
    const idx = Number(last);
    if (idx >= node.length) throw new Error(`路径不存在（replace 要求已存在）：${pointer}`);
    node[idx] = deepClone(value);
  } else if (node !== null && typeof node === "object") {
    if (!Object.hasOwn(node, last)) {
      throw new Error(`路径不存在（replace 要求已存在）：${pointer}`);
    }
    node[last] = deepClone(value);
  } else {
    throw new Error(`路径不存在（replace 要求已存在）：${pointer}`);
  }
  return root;
}

// --- 草稿构建 ----------------------------------------------------------------

/**
 * 把改动意图固化为 profile-draft-v1 草稿（diff 形态，不落整文件副本）。
 * @param {object} currentDoc 当前档案对象（只读，不被修改）
 * @param {Array<{op:"replace", path:string, value:unknown}>} changes 改动清单
 * @param {{targetFingerprint?: string, takenAt?: string}} [options]
 *   targetFingerprint 缺省时按 currentDoc 现算；takenAt 缺省时取当前时间。
 * @returns {{schema, changes, target_fingerprint, state, taken_at}}
 */
export function makeDraft(currentDoc, changes, options = {}) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("changes 不能为空——空改动不值得建草稿");
  }
  for (const change of changes) {
    if (!change || typeof change !== "object") {
      throw new Error("每条 change 须为对象 {op, path, value}");
    }
    if (change.op !== "replace") {
      throw new Error(`不支持的 op：${String(change.op)}（本实现仅支持 replace）`);
    }
    if (typeof change.path !== "string" || !change.path.startsWith("/")) {
      throw new Error(`change.path 须为以 / 开头的 JSON Pointer：${String(change.path)}`);
    }
    if (!("value" in change)) {
      throw new Error(`change.value 缺失：${change.path}`);
    }
  }
  return {
    schema: PROFILE_DRAFT_SCHEMA,
    changes: changes.map((c) => ({ op: "replace", path: c.path, value: deepClone(c.value) })),
    target_fingerprint: options.targetFingerprint ?? fingerprintDoc(currentDoc),
    state: "draft",
    taken_at: options.takenAt ?? new Date().toISOString(),
  };
}

/**
 * 原子生效草稿：先重验指纹，再对克隆体逐条应用。
 * @returns {object} 生效 → {applied:true, newDoc}（newDoc.prev = 上一版深拷贝，单槽链）；
 *   指纹漂移 → {applied:false, conflict:true, reason:"confirm_conflict", ...指纹对}。
 * 草稿结构非法（路径不存在等）抛 Error——此时 currentDoc 原对象分毫不动（原子）。
 */
export function confirmDraft(draft, currentDoc) {
  if (!draft || draft.schema !== PROFILE_DRAFT_SCHEMA) {
    throw new Error("非 profile-draft-v1 草稿对象，拒绝确认");
  }
  const actualFingerprint = fingerprintDoc(currentDoc);
  if (actualFingerprint !== draft.target_fingerprint) {
    return {
      applied: false,
      conflict: true,
      reason: "confirm_conflict",
      expected_fingerprint: draft.target_fingerprint,
      actual_fingerprint: actualFingerprint,
    };
  }
  // 从克隆体开始逐条应用：任一步抛错时 currentDoc 原对象分毫不动（原子生效）。
  let newDoc = deepClone(currentDoc);
  for (const change of draft.changes) {
    newDoc = replaceAt(newDoc, change.path, change.value);
  }
  // 上一版自动保留（单槽链）：回滚可再回滚，任意时刻仅一版"上一版"。
  newDoc.prev = deepClone(currentDoc);
  return { applied: true, newDoc };
}

/**
 * 一键回上一版：doc 含 prev 时返回上一版深拷贝（prev 链自带"回滚可再回滚"）。
 * @returns {{restored:true, doc}} 或无 prev 时 {restored:false, reason:"rollback_refused"}。
 */
export function rollbackToPrev(doc) {
  if (!doc || typeof doc !== "object" || !doc.prev) {
    return { restored: false, reason: "rollback_refused" };
  }
  return { restored: true, doc: deepClone(doc.prev) };
}
