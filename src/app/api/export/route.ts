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

/** 全量导出为 JSON——数据主权兜底，用户随时带走全部记忆。 */
export async function GET(): Promise<Response> {
  const db = getDb();
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
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
