import { listCandidates } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

/** 列出某会话的待确认候选（pending）。确认后由 /api/candidates/[id]/decide 处理。 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.searchParams.get("sessionId");
  const sessionId =
    p != null && p !== "" && !Number.isNaN(Number(p)) ? Number(p) : undefined;
  const candidates = listCandidates({ sessionId, status: "pending" }).map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    content: c.content,
    importance: c.importance,
    theme: c.theme,
  }));
  return Response.json({ candidates });
}
