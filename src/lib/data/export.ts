import { getDb, nowIso } from "@/lib/db/client";
import type { MemoryRow, MessageRow, SessionRow } from "@/lib/memory/types";
import type { CandidateRow } from "@/lib/memory/repo";

/** 导出文件中设置里的 apiKey 一律替换为占位符，绝不出库（数据主权兜底）。 */
export const REDACTED_API_KEY = "__REDACTED__";

export interface EntryRow {
  id: number;
  session_id: number | null;
  kind: string;
  content: string;
  created_at: string;
}

export interface MemoryLinkRow {
  id: number;
  from_id: number;
  to_id: number;
  rel: string;
  note: string | null;
  created_at: string;
}

export interface MemoryEmbeddingExportRow {
  memory_id: number;
  model: string;
  dims: number;
  /** Float32 原字节的 base64——BLOB 经 JSON 序列化往返不丢精度。 */
  vector: string;
  updated_at: string;
}

export interface ExportPayload {
  app: "mine-brain";
  version: 1;
  exported_at: string;
  data: {
    settings: Array<{ key: string; value: string }>;
    sessions: SessionRow[];
    messages: MessageRow[];
    entries: EntryRow[];
    memories: MemoryRow[];
    memory_links: MemoryLinkRow[];
    tags: Array<{ id: number; name: string }>;
    memory_tags: Array<{ memory_id: number; tag_id: number }>;
    memory_candidates: CandidateRow[];
    memory_embeddings: MemoryEmbeddingExportRow[];
  };
}

/** 递归替换任何名为 apiKey（含 api_key / API_KEY 等变体）的属性为占位符。 */
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = k.replace(/[^a-z0-9]/gi, "").toLowerCase();
      out[k] = normalized === "apikey" ? REDACTED_API_KEY : redactSecrets(v);
    }
    return out;
  }
  return value;
}

function redactSettingValue(value: string): string {
  try {
    return JSON.stringify(redactSecrets(JSON.parse(value)));
  } catch {
    return value;
  }
}

/** 全量导出为 JSON 结构。不触碰任何表，只读；向量 BLOB 转 base64 保持可序列化。 */
export function buildExportPayload(): ExportPayload {
  const db = getDb();
  const memory_embeddings = (
    db
      .prepare(
        "SELECT memory_id, model, dims, vector, updated_at FROM memory_embeddings ORDER BY memory_id",
      )
      .all() as Array<{
      memory_id: number;
      model: string;
      dims: number;
      vector: Uint8Array;
      updated_at: string;
    }>
  ).map((r) => ({ ...r, vector: Buffer.from(r.vector).toString("base64") }));

  return {
    app: "mine-brain",
    version: 1,
    exported_at: nowIso(),
    data: {
      settings: (
        db
          .prepare("SELECT key, value FROM settings ORDER BY key")
          .all() as Array<{ key: string; value: string }>
      ).map((r) => ({ ...r, value: redactSettingValue(r.value) })),
      sessions: db.prepare("SELECT * FROM sessions ORDER BY id").all() as unknown as SessionRow[],
      messages: db.prepare("SELECT * FROM messages ORDER BY id").all() as unknown as MessageRow[],
      entries: db.prepare("SELECT * FROM entries ORDER BY id").all() as unknown as EntryRow[],
      memories: db.prepare("SELECT * FROM memories ORDER BY id").all() as unknown as MemoryRow[],
      memory_links: db.prepare("SELECT * FROM memory_links ORDER BY id").all() as unknown as MemoryLinkRow[],
      tags: db.prepare("SELECT * FROM tags ORDER BY id").all() as unknown as Array<{ id: number; name: string }>,
      memory_tags: db
        .prepare("SELECT * FROM memory_tags ORDER BY memory_id, tag_id")
        .all() as unknown as Array<{ memory_id: number; tag_id: number }>,
      memory_candidates: db.prepare("SELECT * FROM memory_candidates ORDER BY id").all() as unknown as CandidateRow[],
      memory_embeddings,
    },
  };
}
