import { buildExportPayload } from "@/lib/data/export";

export const dynamic = "force-dynamic";

/** 全量导出为 JSON——数据主权兜底。密钥不出导出文件：ai 配置里的 apiKey 一律脱敏。 */
export async function GET(): Promise<Response> {
  const payload = buildExportPayload();
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mine-brain-export-${payload.exported_at.slice(0, 10)}.json"`,
    },
  });
}
