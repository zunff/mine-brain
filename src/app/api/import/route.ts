import { mkdirSync } from "node:fs";
import path from "node:path";
import { getDb, nowIso } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ImportPayload {
  app?: string;
  version?: number;
  data?: Record<string, Record<string, unknown>[]>;
}

const DATA_TABLES = [
  "sessions",
  "messages",
  "entries",
  "memories",
  "memory_links",
  "tags",
  "memory_tags",
] as const;

/** 删除顺序：先子后父（外键约束） */
const DELETE_ORDER = [
  "memory_tags",
  "tags",
  "memory_links",
  "memories",
  "entries",
  "messages",
  "sessions",
] as const;

const INSERT_ORDER = [
  "sessions",
  "entries",
  "messages",
  "memories",
  "memory_links",
  "tags",
  "memory_tags",
] as const;

/** 导入前 VACUUM INTO 快照；导入失败自动回滚，原数据不动。 */
function toSqlValue(v: unknown): string | number | bigint | Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "bigint" ||
    v instanceof Uint8Array
  ) {
    return v;
  }
  return JSON.stringify(v);
}
export async function POST(req: Request): Promise<Response> {
  let payload: ImportPayload;
  try {
    payload = (await req.json()) as ImportPayload;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (payload.app !== "mine-brain" || payload.version !== 1 || !payload.data) {
    return Response.json(
      { ok: false, error: "不是有效的 mine-brain 导出文件" },
      { status: 400 },
    );
  }
  const data = payload.data;
  for (const t of [...DATA_TABLES, "settings"]) {
    if (!Array.isArray(data[t])) {
      return Response.json(
        { ok: false, error: `导出缺少 ${t} 表` },
        { status: 400 },
      );
    }
  }

  const db = getDb();

  // 一致性快照备份（VACUUM INTO 不能在事务内）
  let backupPath = "";
  try {
    const backupDir = path.join(process.cwd(), "data", "backups");
    mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `pre-import-${nowIso().replace(/[:.]/g, "-")}.db`);
    db.exec(`VACUUM INTO '${backupPath.replace(/\\/g, "/")}'`);
  } catch (err) {
    return Response.json(
      { ok: false, error: `备份失败，已中止导入：${String(err)}` },
      { status: 500 },
    );
  }

  db.exec("BEGIN");
  try {
    // 导出中的密钥已脱敏；若导入文件无法还原真实配置，则保留本地 ai 设置
    const localAi = db
      .prepare("SELECT value FROM settings WHERE key = 'ai'")
      .get() as { value: string } | undefined;

    for (const t of DELETE_ORDER) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM settings");

    for (const t of INSERT_ORDER) {
      for (const row of data[t]) {
        const cols = Object.keys(row);
        if (!cols.includes("id")) continue; // 无 id 的行无法保证关系完整性
        const placeholders = cols.map(() => "?").join(",");
        db.prepare(
          `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`,
        ).run(...cols.map((c) => toSqlValue(row[c])));
      }
    }

    // settings：跳过被脱敏的 ai 配置，其余原样恢复
    let skippedSettings = 0;
    for (const row of data.settings) {
      if (row.key === "ai") {
        const raw = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
        if (raw.includes("__REDACTED__")) {
          if (localAi) {
            db.prepare("INSERT INTO settings (key, value) VALUES ('ai', ?)").run(
              localAi.value,
            );
          }
          skippedSettings++;
          continue;
        }
      }
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
        String(row.key),
        typeof row.value === "string" ? row.value : JSON.stringify(row.value),
      );
    }

    db.exec("COMMIT");
    const counts: Record<string, number> = {};
    for (const t of [...INSERT_ORDER, "settings"]) counts[t] = data[t]?.length ?? 0;
    return Response.json({ ok: true, backup: path.basename(backupPath), counts });
  } catch (err) {
    db.exec("ROLLBACK");
    return Response.json(
      {
        ok: false,
        error: `导入失败已回滚（原数据未动）：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      },
      { status: 500 },
    );
  }
}
