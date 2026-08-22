import { getDb } from "@/lib/db/client";
import { nowIso } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const TABLES = [
  "sessions",
  "messages",
  "entries",
  "memories",
  "memory_links",
  "tags",
  "memory_tags",
  "settings",
] as const;

/** 全量导出为 JSON——数据主权兜底。密钥不出导出文件：ai 配置里的 apiKey 一律脱敏。 */
export async function GET(): Promise<Response> {
  const db = getDb();
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>;
    if (t === "settings") {
      for (const row of rows) {
        if (row.key === "ai" && typeof row.value === "string") {
          try {
            const cfg = JSON.parse(row.value) as Record<string, unknown>;
            if (typeof cfg.apiKey === "string" && cfg.apiKey) cfg.apiKey = "__REDACTED__";
            row.value = JSON.stringify(cfg);
          } catch {
            /* 保持原样 */
          }
        }
      }
    }
    dump[t] = rows;
  }
  const payload = {
    app: "mine-brain",
    version: 1,
    exported_at: nowIso(),
    data: dump,
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mine-brain-export-${nowIso().slice(0, 10)}.json"`,
    },
  });
}
