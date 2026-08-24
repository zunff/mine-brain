import { mkdirSync } from "node:fs";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import type { MemoryRow, MessageRow, SessionRow } from "@/lib/memory/types";
import type { CandidateRow } from "@/lib/memory/repo";
import type { EntryRow, MemoryEmbeddingExportRow, MemoryLinkRow } from "./export";

/** 结构校验失败（非法文件/字段类型不符）——API 层映射为 400。 */
export class ImportValidationError extends Error {}

/** 导入侧刻意宽松：入参来自任意 JSON，结构必须运行时校验（app/version/data 形状）。 */
export interface ImportPayload {
  app: string;
  version: number;
  data: Record<string, unknown>;
}

export interface ImportCounts {
  sessions: number;
  messages: number;
  entries: number;
  memories: number;
  memory_links: number;
  tags: number;
  memory_tags: number;
  memory_candidates: number;
  memory_embeddings: number;
}

export interface ImportResult {
  backupFile: string;
  counts: ImportCounts;
  /** 导出里的设置行数——导入一律跳过设置，保住本地真实密钥。 */
  skippedSettings: number;
}

function asArray<T>(value: unknown, label: string): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ImportValidationError(`data.${label} 应为数组`);
  return value as T[];
}

/** base64 → 原始字节。校验是正规 base64 且字节数与 dims 一致，非法即整单拒绝。 */
function decodeVector(base64: string, dims: number): Buffer {
  if (typeof base64 !== "string") throw new ImportValidationError("memory_embeddings.vector 应为 base64 字符串");
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0 || Buffer.from(buf.toString("base64"), "base64").length !== buf.length) {
    throw new ImportValidationError("memory_embeddings 含非法 base64");
  }
  if (buf.length !== dims * 4) {
    throw new ImportValidationError("memory_embeddings 向量字节数与 dims 不符");
  }
  return buf;
}

function runMany(db: DatabaseSync, sql: string, rows: SQLInputValue[][]): number {
  const stmt = db.prepare(sql);
  for (const params of rows) stmt.run(...params);
  return rows.length;
}

/** 导入前快照当前库：VACUUM INTO 产出含 WAL 的一致副本，绝不覆盖用户可能想回滚的状态。 */
function backupCurrentDb(): string {
  const dataDir = process.env.MINE_BRAIN_DATA_DIR ?? path.join(process.cwd(), "data");
  const backupsDir = path.join(dataDir, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupsDir, `mine-brain-backup-${stamp}.db`);
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

const INSERT = {
  sessions:
    "INSERT INTO sessions (id, title, summary, consolidated_upto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  messages:
    "INSERT INTO messages (id, session_id, role, content, reasoning, images, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  entries:
    "INSERT INTO entries (id, session_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)",
  memories:
    "INSERT INTO memories (id, type, title, content, status, importance, theme, sentiment, valid_from, valid_to, source_entry_id, session_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  links:
    "INSERT INTO memory_links (id, from_id, to_id, rel, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  tags: "INSERT INTO tags (id, name) VALUES (?, ?)",
  memoryTags:
    "INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, ?)",
  candidates:
    "INSERT INTO memory_candidates (id, type, title, content, importance, theme, sentiment, tags, supersedes, contradicts, source_entry_id, session_id, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  embeddings:
    "INSERT INTO memory_embeddings (memory_id, model, dims, vector, updated_at) VALUES (?, ?, ?, ?, ?)",
} as const;

/**
 * 覆盖式恢复：备份 → 事务内清空重建 → 提交；任一失败回滚，原数据不动。
 * 设置一律跳过（导出里密钥已脱敏，导入会抹掉本地真实密钥）。显式保留原始 id，
 * 使 entry/session 溯源、supersedes/contradicts 关联、向量 memory_id 全部对得上。
 */
export function importPayload(payload: ImportPayload): ImportResult {
  if (!payload || typeof payload !== "object" || payload.app !== "mine-brain" || payload.version !== 1) {
    throw new ImportValidationError("非法文件：不是 mine-brain 备份");
  }
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ImportValidationError("非法文件：缺少 data 结构");
  }

  const sessions = asArray<SessionRow>(data.sessions, "sessions");
  const messages = asArray<MessageRow>(data.messages, "messages");
  const entries = asArray<EntryRow>(data.entries, "entries");
  const memories = asArray<MemoryRow>(data.memories, "memories");
  const memoryLinks = asArray<MemoryLinkRow>(data.memory_links, "memory_links");
  const tags = asArray<{ id: number; name: string }>(data.tags, "tags");
  const memoryTags = asArray<{ memory_id: number; tag_id: number }>(data.memory_tags, "memory_tags");
  const candidates = asArray<CandidateRow>(data.memory_candidates, "memory_candidates");
  const embeddings = asArray<MemoryEmbeddingExportRow>(data.memory_embeddings, "memory_embeddings");
  const skippedSettings = asArray<{ key: string; value: string }>(data.settings, "settings").length;

  // 先解码全部向量并校验，全部合法后才动数据库。
  const decodedEmbeddings = embeddings.map((e) => ({ ...e, vector: decodeVector(e.vector, e.dims) }));

  const backupFile = backupCurrentDb();

  const db = getDb();
  db.exec("BEGIN");
  try {
    // 子表先删（foreign_keys=ON），清空记忆域数据；settings 表不动。
    db.exec("DELETE FROM memory_embeddings");
    db.exec("DELETE FROM memory_candidates");
    db.exec("DELETE FROM memory_links");
    db.exec("DELETE FROM memory_tags");
    db.exec("DELETE FROM tags");
    db.exec("DELETE FROM memories");
    db.exec("DELETE FROM messages");
    db.exec("DELETE FROM entries");
    db.exec("DELETE FROM sessions");

    const counts: ImportCounts = {
      sessions: runMany(db, INSERT.sessions, sessions.map((r) => [r.id, r.title, r.summary, r.consolidated_upto, r.created_at, r.updated_at])),
      messages: runMany(db, INSERT.messages, messages.map((r) => [r.id, r.session_id, r.role, r.content, r.reasoning, r.images, r.created_at])),
      entries: runMany(db, INSERT.entries, entries.map((r) => [r.id, r.session_id, r.kind, r.content, r.created_at])),
      memories: runMany(db, INSERT.memories, memories.map((r) => [r.id, r.type, r.title, r.content, r.status, r.importance, r.theme, r.sentiment, r.valid_from, r.valid_to, r.source_entry_id, r.session_id, r.created_at, r.updated_at, r.deleted_at])),
      memory_links: runMany(db, INSERT.links, memoryLinks.map((r) => [r.id, r.from_id, r.to_id, r.rel, r.note, r.created_at])),
      tags: runMany(db, INSERT.tags, tags.map((r) => [r.id, r.name])),
      memory_tags: runMany(db, INSERT.memoryTags, memoryTags.map((r) => [r.memory_id, r.tag_id])),
      memory_candidates: runMany(db, INSERT.candidates, candidates.map((r) => [r.id, r.type, r.title, r.content, r.importance, r.theme, r.sentiment, r.tags, r.supersedes, r.contradicts, r.source_entry_id, r.session_id, r.status, r.created_at, r.decided_at])),
      memory_embeddings: runMany(db, INSERT.embeddings, decodedEmbeddings.map((r) => [r.memory_id, r.model, r.dims, r.vector, r.updated_at])),
    };

    db.exec("COMMIT");
    return { backupFile, counts, skippedSettings };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 事务可能未成功开启 */
    }
    throw err;
  }
}
