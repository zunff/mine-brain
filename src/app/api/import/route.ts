import {
  importPayload,
  ImportValidationError,
  type ImportPayload,
} from "@/lib/data/import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 薄壳：校验 JSON → lib 执行（备份+事务+回滚都在 lib 内）。 */
export async function POST(req: Request): Promise<Response> {
  let payload: ImportPayload;
  try {
    payload = (await req.json()) as ImportPayload;
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  try {
    const result = importPayload(payload);
    return Response.json({
      ok: true,
      backup: result.backupFile,
      counts: { ...result.counts, skippedSettings: result.skippedSettings },
    });
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
