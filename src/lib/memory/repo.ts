import { getDb, nowIso } from "@/lib/db/client";
import {
  canSupersede,
  MEMORY_TYPES,
  THEMES,
  type CandidateStatus,
  type ExtractItem,
  type LinkRel,
  type MemoryRow,
  type MemoryStatus,
  type MemoryType,
  type MessageRow,
  type SessionRow,
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
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM sessions s ORDER BY s.updated_at DESC LIMIT 200`,
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

/** 更新已存在消息的内容（流式节流落库用）。 */
export function updateMessageContent(
  id: number,
  content: string,
  reasoning: string | null,
): void {
  getDb()
    .prepare("UPDATE messages SET content = ?, reasoning = ? WHERE id = ?")
    .run(content, reasoning, id);
}

export function listMessages(sessionId: number, limit = 200): MessageRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(sessionId, limit)
    .reverse() as unknown as MessageRow[];
}

/** 取某会话中 id 大于 afterId 的最近 limit 条消息（升序）。分批整理用：每次只推进真正处理过的批次。 */
export function listMessagesAfter(
  sessionId: number,
  afterId: number,
  limit = 200,
): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(sessionId, afterId, limit) as unknown as MessageRow[];
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

/* ---------------- memory embeddings（向量，模型维度记录） ---------------- */

/** 写入/覆盖某记忆的当前模型向量。 */
export function setMemoryEmbedding(
  memoryId: number,
  model: string,
  dims: number,
  vector: Float32Array,
): void {
  getDb()
    .prepare(
      "INSERT INTO memory_embeddings (memory_id, model, dims, vector, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET model = excluded.model, dims = excluded.dims, vector = excluded.vector, updated_at = excluded.updated_at",
    )
    .run(memoryId, model, dims, Buffer.from(vector.buffer), nowIso());
}

export interface StoredEmbedding {
  memory_id: number;
  dims: number;
  vector: Float32Array;
}

/** 取指定模型下的全部向量（跨模型向量不互通，调用方必须按 model 过滤）。 */
export function embeddingsFor(model: string): StoredEmbedding[] {
  const rows = getDb()
    .prepare("SELECT memory_id, dims, vector FROM memory_embeddings WHERE model = ?")
    .all(model) as Array<{ memory_id: number; dims: number; vector: Uint8Array }>;
  return rows.map((r) => ({
    memory_id: r.memory_id,
    dims: r.dims,
    vector: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength)),
  }));
}

/** 当前 (model, dims) 下还缺向量的 active 记忆数（重嵌进度用）。
 * dims 参与匹配：同模型改维度后旧向量不再算数，必须重嵌（跨维度比余弦=噪音）。 */
export function embeddingsMissingCount(ids: number[], model: string, dims: number): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const row = getDb()
    .prepare(
      `SELECT count(*) c FROM memories m
       LEFT JOIN memory_embeddings e ON e.memory_id = m.id AND e.model = ? AND e.dims = ?
       WHERE m.deleted_at IS NULL AND m.status = 'active' AND m.id IN (${placeholders}) AND e.memory_id IS NULL`,
    )
    .get(model, dims, ...ids) as { c: number };
  return row.c;
}

/* ---------------- memory candidates（暂存待确认） ---------------- */

export interface CandidateRow {
  id: number;
  type: MemoryType;
  title: string;
  content: string;
  importance: number;
  theme: string | null;
  sentiment: number | null;
  tags: string | null;
  supersedes: number | null;
  contradicts: string | null;
  source_entry_id: number | null;
  session_id: number | null;
  status: CandidateStatus;
  created_at: string;
  decided_at: string | null;
}

/** 把一条抽取结果写入候选暂存（不触碰正式 memories）。type/theme/数值在此归一化。 */
export function insertCandidate(item: ExtractItem, entryId: number, sessionId: number): number {
  const type = MEMORY_TYPES.includes(item.type as MemoryType)
    ? (item.type as MemoryType)
    : "claim";
  const theme =
    item.theme && THEMES.includes(item.theme as (typeof THEMES)[number])
      ? item.theme
      : null;
  const res = getDb()
    .prepare(
      `INSERT INTO memory_candidates
        (type, title, content, importance, theme, sentiment, tags, supersedes, contradicts,
         source_entry_id, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      type,
      String(item.title ?? "").slice(0, 80),
      (item.content ?? "").trim().slice(0, 2000),
      clampNum(item.importance, 0, 1, 0.5),
      theme,
      item.sentiment == null ? null : clampNum(item.sentiment, -1, 1, 0),
      Array.isArray(item.tags) ? JSON.stringify(item.tags.map(String).slice(0, 12)) : null,
      item.supersedes ? Number(item.supersedes) : null,
      Array.isArray(item.contradicts)
        ? JSON.stringify(item.contradicts.slice(0, 3).map(Number))
        : null,
      entryId,
      sessionId,
      nowIso(),
    );
  return Number(res.lastInsertRowid);
}

export function getCandidate(id: number): CandidateRow | null {
  return (
    (getDb().prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id) as
      | CandidateRow
      | undefined) ?? null
  );
}

export function listCandidates(
  f: { sessionId?: number; status?: CandidateStatus; limit?: number } = {},
): CandidateRow[] {
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (f.sessionId != null) {
    where.push("session_id = ?");
    args.push(f.sessionId);
  }
  if (f.status) {
    where.push("status = ?");
    args.push(f.status);
  }
  args.push(f.limit ?? 100);
  return getDb()
    .prepare(
      `SELECT * FROM memory_candidates WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
    )
    .all(...args) as unknown as CandidateRow[];
}

/** 确认候选：落正式记忆 + 标签 + 关联边。语义守卫在此生效（value 封口 / canSupersede）。 */
export function approveCandidate(id: number): number {
  const c = getCandidate(id);
  if (!c) throw new Error(`candidate ${id} not found`);
  if (c.status !== "pending") throw new Error(`candidate ${id} already decided`);

  const memoryId = insertMemory({
    type: c.type,
    title: c.title,
    content: c.content,
    importance: c.importance,
    sentiment: c.sentiment,
    theme: c.theme,
    sourceEntryId: c.source_entry_id,
    sessionId: c.session_id,
  });

  let tags: string[] = [];
  if (c.tags) {
    try {
      const parsed = JSON.parse(c.tags);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      /* 忽略损坏的标签 */
    }
  }
  setTags(memoryId, tags);

  // 价值观按条独立存储（onboarding v2 起）：确认一条新 value 不再自动封口其余 value——
  // 多条价值观并存不是取代关系；只有 extractor/用户显式指定 supersedes 某条时才封口。
  if (c.supersedes && getMemory(c.supersedes)) {
    if (canSupersede(c.type)) {
      supersedeMemory(c.supersedes, memoryId);
    } else {
      linkMemories(memoryId, c.supersedes, "related_to", "观察类记忆的模型误填，已降级");
    }
  }
  if (c.contradicts) {
    try {
      const cids = JSON.parse(c.contradicts) as number[];
      for (const cid of cids) {
        if (getMemory(cid)) linkMemories(memoryId, cid, "contradicts");
      }
    } catch {
      /* 忽略损坏的 contradicts */
    }
  }

  getDb()
    .prepare("UPDATE memory_candidates SET status = 'approved', decided_at = ? WHERE id = ?")
    .run(nowIso(), id);
  return memoryId;
}

export function rejectCandidate(id: number): void {
  getDb()
    .prepare(
      "UPDATE memory_candidates SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(nowIso(), id);
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
