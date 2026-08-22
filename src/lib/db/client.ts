import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

let dbInstance: DatabaseSync | null = null;

/**
 * 惰性单例。绝不在模块顶层调用——否则 next build 阶段会误开数据库。
 * 数据目录可用 MINE_BRAIN_DATA_DIR 覆盖（测试隔离用），默认 <项目根>/data。
 */
export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const dataDir = process.env.MINE_BRAIN_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "mine-brain.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  dbInstance = db;
  return db;
}

/** 测试专用：关闭并清空单例，使下一个 getDb() 在新数据目录重建。生产代码禁止调用。 */
export function __resetDbForTests(): void {
  try {
    dbInstance?.close();
  } catch {
    /* 已关闭 */
  }
  dbInstance = null;
}

function migrate(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const appliedRows = db.prepare("SELECT id FROM _migrations").all() as Array<{
    id: number;
  }>;
  const applied = new Set(appliedRows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
        m.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.id} failed: ${String(err)}`);
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
