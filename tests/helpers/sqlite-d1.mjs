/**
 * 测试用 D1 替身：用 better-sqlite3 实现 Cloudflare D1 的最小接口，
 * 让私有平台的数据层在真实 SQL 语义下被测试（约束、唯一索引、事务）。
 */
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIGRATIONS_DIR = new URL("../../platform/migrations/", import.meta.url);

function normalizeParams(params) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

class SqliteStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteStatement(this.db, this.sql, normalizeParams(params));
  }

  execute() {
    const statement = this.db.prepare(this.sql);
    if (statement.reader) return { rows: statement.all(...this.params), changes: 0, lastRowId: 0 };
    const info = statement.run(...this.params);
    return { rows: [], changes: info.changes, lastRowId: Number(info.lastInsertRowid) };
  }

  async first(column) {
    const { rows } = this.execute();
    const row = rows[0] ?? null;
    if (row === null) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  async all() {
    const { rows } = this.execute();
    return { success: true, results: rows, meta: {} };
  }

  async run() {
    const { rows, changes, lastRowId } = this.execute();
    return { success: true, results: rows, meta: { changes, last_row_id: lastRowId } };
  }

  async raw() {
    const { rows } = this.execute();
    return rows.map((row) => Object.values(row));
  }
}

class SqliteD1 {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements) {
    const runAll = this.db.transaction((items) => items.map((item) => {
      const { rows, changes, lastRowId } = item.execute();
      return { success: true, results: rows, meta: { changes, last_row_id: lastRowId } };
    }));
    return runAll(statements);
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}

export function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), "platform-d1-test-")), "db.sqlite");
}

export function createSqliteD1({ readonly = false, path } = {}) {
  if (readonly && !path) throw new Error("readonly 替身必须指定 path");
  const db = new Database(path ?? ":memory:", readonly ? { readonly: true, fileMustExist: true } : {});
  db.pragma("foreign_keys = ON");
  return new SqliteD1(db);
}

export async function applyPlatformMigrations(d1) {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    await d1.exec(readFileSync(new URL(name, MIGRATIONS_DIR), "utf-8"));
  }
}
