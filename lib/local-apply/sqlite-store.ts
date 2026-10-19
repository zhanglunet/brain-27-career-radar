/**
 * SQLite-backed draft store (PRD-080 生产落地-3).
 *
 * Drop-in replacement for the in-memory `createDraftStore()` in
 * `lib/local-apply/drafter.ts`: identical interface (save / list / get,
 * version auto-increment `cv:opp-x:v1…`), persisted to a local SQLite file.
 *
 * 数据主权红线（T1 §二/§五）：
 * - 本模块只读写本地 SQLite 文件（默认 ~/.brain27/brain27.db），
 *   不发起任何网络请求、不向任何服务器同步、不上传任何内容；
 * - 草稿内容（简历/PS/套磁信）永不出机器；
 * - 数据库文件权限 0600（仅属主可读写），目录 0700。
 *
 * 依赖：`better-sqlite3`（需在 package.json dependencies 中加入，
 * 本 PR 为纯加法未改 package.json，接入时请补一行）。
 */

import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** 草稿类型：与 drafter.ts 的 DraftKind 保持一致（本地复制，避免跨模块依赖）。 */
export type DraftKind = "cv" | "ps" | "email";

/** 单份草稿：字段与 drafter.ts 的 Draft 逐项对齐。 */
export type Draft = {
  /** `${kind}:${opportunityId}:v${version}` */
  id: string;
  kind: DraftKind;
  opportunityId: string;
  /** 同一 (kind, opportunityId) 下从 1 递增 */
  version: number;
  /** ISO 8601 */
  createdAt: string;
  /** AI 草稿标注，与 drafter.ts 的 AI_DRAFT_MARKER 同值 */
  marker: string;
  content: string;
};

/** 草稿存储接口：与 drafter.ts 的 DraftStore 逐项对齐。 */
export type DraftStore = {
  save(kind: DraftKind, opportunityId: string, content: string): Draft;
  list(opportunityId?: string): Draft[];
  get(kind: DraftKind, opportunityId: string, version?: number): Draft | undefined;
};

export const AI_DRAFT_MARKER = "AI 草稿，需人工改写";

/**
 * 默认数据库路径：`~/.brain27/brain27.db`。
 * 可用 `BRAIN27_HOME` 环境变量覆盖根目录（T1 §4.3）。
 */
export function defaultDbPath(): string {
  const home = process.env.BRAIN27_HOME ?? join(homedir(), ".brain27");
  return join(home, "brain27.db");
}

type SqliteStoreOptions = {
  /** 数据库文件路径；缺省走 defaultDbPath()。测试必须传临时文件。 */
  path?: string;
  /** 时间源（可注入，便于测试）；缺省 new Date()。 */
  now?: () => Date;
};

/**
 * 打开（不存在则创建）SQLite 草稿库，返回 DraftStore。
 *
 * 表结构（T1 §4.3 materials 语义）：
 *   materials(id TEXT PRIMARY KEY, kind TEXT, opportunity_id TEXT,
 *             version INTEGER, created_at TEXT, marker TEXT, content TEXT)
 */
export function createSqliteDraftStore(
  options: SqliteStoreOptions = {},
): DraftStore & { close(): void } {
  const dbPath = options.path ?? defaultDbPath();
  const now = options.now ?? (() => new Date());

  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  // 文件由 better-sqlite3 按 umask 创建（通常 0644），收紧为仅属主可读写。
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // 最佳努力：极少数受限文件系统上 chmod 可能失败，不阻塞打开。
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      marker TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_materials_lookup
      ON materials (opportunity_id, kind, version);
  `);

  const nextVersion = db.prepare(
    `SELECT COALESCE(MAX(version), 0) AS v FROM materials
     WHERE kind = ? AND opportunity_id = ?`,
  );
  const insertRow = db.prepare(
    `INSERT INTO materials
       (id, kind, opportunity_id, version, created_at, marker, content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectAll = db.prepare(
    `SELECT id, kind, opportunity_id, version, created_at, marker, content
     FROM materials ORDER BY rowid`,
  );
  const selectByOpp = db.prepare(
    `SELECT id, kind, opportunity_id, version, created_at, marker, content
     FROM materials WHERE opportunity_id = ? ORDER BY rowid`,
  );
  const selectLatest = db.prepare(
    `SELECT id, kind, opportunity_id, version, created_at, marker, content
     FROM materials WHERE kind = ? AND opportunity_id = ?
     ORDER BY version DESC LIMIT 1`,
  );
  const selectVersion = db.prepare(
    `SELECT id, kind, opportunity_id, version, created_at, marker, content
     FROM materials WHERE kind = ? AND opportunity_id = ? AND version = ?`,
  );

  function rowToDraft(row: {
    id: string;
    kind: string;
    opportunity_id: string;
    version: number;
    created_at: string;
    marker: string;
    content: string;
  }): Draft {
    return {
      id: row.id,
      kind: row.kind as DraftKind,
      opportunityId: row.opportunity_id,
      version: row.version,
      createdAt: row.created_at,
      marker: row.marker,
      content: row.content,
    };
  }

  return {
    save(kind, opportunityId, content) {
      const row = nextVersion.get(kind, opportunityId) as { v: number };
      const version = row.v + 1;
      const draft: Draft = {
        id: `${kind}:${opportunityId}:v${version}`,
        kind,
        opportunityId,
        version,
        createdAt: now().toISOString(),
        marker: AI_DRAFT_MARKER,
        content,
      };
      insertRow.run(
        draft.id,
        draft.kind,
        draft.opportunityId,
        draft.version,
        draft.createdAt,
        draft.marker,
        draft.content,
      );
      return draft;
    },
    list(opportunityId?: string) {
      const rows =
        opportunityId === undefined
          ? (selectAll.all() as Parameters<typeof rowToDraft>[0][])
          : (selectByOpp.all(opportunityId) as Parameters<typeof rowToDraft>[0][]);
      return rows.map(rowToDraft);
    },
    get(kind, opportunityId, version?: number) {
      const row =
        version === undefined
          ? (selectLatest.get(kind, opportunityId) as
              | Parameters<typeof rowToDraft>[0]
              | undefined)
          : (selectVersion.get(kind, opportunityId, version) as
              | Parameters<typeof rowToDraft>[0]
              | undefined);
      return row === undefined ? undefined : rowToDraft(row);
    },
    close() {
      db.close();
    },
  };
}

/**
 * 迁移说明（给 CLI 接线用，本 PR 不改 cli.ts）：
 *
 *   // 之前（内存，进程结束即失）：
 *   import { createDraftStore } from "./drafter.ts";
 *   const store = createDraftStore();
 *
 *   // 之后（SQLite 落盘）：
 *   import { createSqliteDraftStore } from "./sqlite-store.ts";
 *   const store = createSqliteDraftStore(); // 默认 ~/.brain27/brain27.db
 *   // 进程退出前调用 store.close()
 *
 * 接口完全一致（save / list / get），调用方除构造与 close 外无需改动。
 * 另需在 package.json dependencies 补一行 `"better-sqlite3": "^13.0.3"`。
 */
