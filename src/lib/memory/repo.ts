import { getDb, nowIso } from "@/lib/db/client";
import type {
  MemoryRow,
  MemoryType,
  MemoryStatus,
  LinkRel,
  SessionRow,
  MessageRow,
} from "./types";
import { defaultAiSettings, type AiSettings } from "@/lib/providers/registry";

/* ---------------- settings ---------------- */

export function getSetting<T>(key: string): T | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(value));
}

export function getAiSettings(): AiSettings {
  const stored = getSetting<Partial<AiSettings>>("ai");
  const base = defaultAiSettings();
  if (!stored) return base;
  return {
    baseUrl: stored.baseUrl?.trim() || base.baseUrl,
    apiKey: stored.apiKey?.trim() || base.apiKey,
    model: stored.model?.trim() || base.model,
    roles: { ...base.roles, ...stored.roles },
  };
}

/* ---------------- sessions & messages ---------------- */

export function listSessions(): SessionRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 200",
    )
    .all() as unknown as SessionRow[];
}

export function createSession(title = "新对话"): SessionRow {
  const now = nowIso();
  const res = getDb()
    .prepare("INSERT INTO sessions (title, created_at, updated_at) VALUES (?, ?, ?)")
    .run(title, now, now);
  return getSession(Number(res.lastInsertRowid))!;
}

export function getSession(id: number): SessionRow | null {
  return (
    (getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined) ?? null
  );
}

export function touchSession(id: number, patch?: { title?: string; summary?: string; consolidatedUpto?: number }): void {
  const s = getSession(id);
  if (!s) return;
  getDb()
    .prepare("UPDATE sessions SET title = ?, summary = ?, consolidated_upto = ?, updated_at = ? WHERE id = ?")
    .run(
      patch?.title ?? s.title,
      patch?.summary ?? s.summary,
      patch?.consolidatedUpto ?? s.consolidated_upto,
      nowIso(),
      id,
    );
}

export function addMessage(
  sessionId: number,
  role: "user" | "assistant",
  content: string,
  reasoning?: string,
  images?: string[],
): MessageRow {
  const now = nowIso();
  const res = getDb()
    .prepare(
      "INSERT INTO messages (session_id, role, content, reasoning, images, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      sessionId,
      role,
      content,
      reasoning ?? null,
      images && images.length > 0 ? JSON.stringify(images) : null,
      now,
    );
  touchSession(sessionId);
  return {
    id: Number(res.lastInsertRowid),
    session_id: sessionId,
    role,
    content,
    reasoning: reasoning ?? null,
    images: images && images.length > 0 ? JSON.stringify(images) : null,
    created_at: now,
  };
}

export function listMessages(sessionId: number, limit = 200): MessageRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(sessionId, limit)
    .reverse() as unknown as MessageRow[];
}

/* ---------------- entries（不可变原始摄取） ---------------- */

export function addEntry(
  kind: "chat" | "journal" | "voice" | "import" | "onboarding",
  content: string,
  sessionId?: number | null,
): number {
  const res = getDb()
    .prepare("INSERT INTO entries (session_id, kind, content, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId ?? null, kind, content, nowIso());
  return Number(res.lastInsertRowid);
}

/* ---------------- memories ---------------- */

export interface NewMemory {
  type: MemoryType;
  title?: string;
  content: string;
  importance?: number;
  theme?: string | null;
  sentiment?: number | null;
  validFrom?: string;
  sourceEntryId?: number | null;
  sessionId?: number | null;
  status?: MemoryStatus;
}

export function insertMemory(m: NewMemory): number {
  const now = nowIso();
  const res = getDb()
    .prepare(
      `INSERT INTO memories (type, title, content, status, importance, theme, sentiment,
        valid_from, source_entry_id, session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.type,
      m.title ?? "",
      m.content,
      m.status ?? "active",
      clamp(m.importance ?? 0.5, 0, 1),
      m.theme ?? null,
      m.sentiment == null ? null : clamp(m.sentiment, -1, 1),
      m.validFrom ?? now,
      m.sourceEntryId ?? null,
      m.sessionId ?? null,
      now,
      now,
    );
  return Number(res.lastInsertRowid);
}

export function getMemory(id: number): MemoryRow | null {
  return (
    (getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as
      | MemoryRow
      | undefined) ?? null
  );
}

export interface ListMemoryFilter {
  type?: MemoryType;
  theme?: string;
  includeInactive?: boolean;
  limit?: number;
}

export function listMemories(f: ListMemoryFilter = {}): MemoryRow[] {
  const where: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];
  if (!f.includeInactive) where.push("status = 'active'");
  if (f.type) {
    where.push("type = ?");
    args.push(f.type);
  }
  if (f.theme) {
    where.push("theme = ?");
    args.push(f.theme);
  }
  args.push(f.limit ?? 500);
  return getDb()
    .prepare(
      `SELECT * FROM memories WHERE ${where.join(" AND ")}
       ORDER BY importance DESC, created_at DESC LIMIT ?`,
    )
    .all(...args) as unknown as MemoryRow[];
}

/** 信念变更：永不覆盖语义，只把旧行标记为 superseded 并封口时间。 */
export function supersedeMemory(oldId: number, successorId?: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE memories SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?",
  ).run(nowIso(), nowIso(), oldId);
  if (successorId) {
    linkMemories(successorId, oldId, "supersedes");
  }
}

export function softDeleteMemory(id: number): void {
  getDb()
    .prepare("UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
}

export function setMemoryStatus(id: number, status: MemoryStatus): void {
  const extra =
    status === "superseded" ? ", valid_to = '" + nowIso() + "'" : "";
  getDb()
    .prepare(`UPDATE memories SET status = ?, updated_at = ?${extra} WHERE id = ?`)
    .run(status, nowIso(), id);
}

export function updateImportance(id: number, importance: number): void {
  getDb()
    .prepare("UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?")
    .run(clamp(importance, 0, 1), nowIso(), id);
}

/* ---------------- links & tags ---------------- */

export function linkMemories(
  fromId: number,
  toId: number,
  rel: LinkRel,
  note?: string,
): void {
  if (fromId === toId) return;
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO memory_links (from_id, to_id, rel, note, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(fromId, toId, rel, note ?? null, nowIso());
}

export function linksFor(ids: number[]): Map<number, Array<{ to_id: number; from_id: number; rel: string }>> {
  const map = new Map<number, Array<{ to_id: number; from_id: number; rel: string }>>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT from_id, to_id, rel FROM memory_links
       WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
    )
    .all(...ids, ...ids) as Array<{ from_id: number; to_id: number; rel: string }>;
  for (const r of rows) {
    const key = ids.includes(r.from_id) ? r.from_id : r.to_id;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return map;
}

export function setTags(memoryId: number, names: string[]): void {
  const db = getDb();
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
  for (const name of clean) {
    db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
    const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as
      | { id: number }
      | undefined;
    if (tag) {
      db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag_id) VALUES (?, ?)").run(memoryId, tag.id);
    }
  }
}

export function tagsByMemoryIds(ids: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT mt.memory_id, t.name FROM memory_tags mt JOIN tags t ON t.id = mt.tag_id
       WHERE mt.memory_id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ memory_id: number; name: string }>;
  for (const r of rows) {
    const arr = map.get(r.memory_id) ?? [];
    arr.push(r.name);
    map.set(r.memory_id, arr);
  }
  return map;
}

export function allTagNames(): string[] {
  return (
    getDb().prepare("SELECT name FROM tags ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
