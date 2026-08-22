import { consolidateSession } from "@/lib/memory/consolidate";
import { listCandidates } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ConsolidateBody {
  sessionId?: number | string;
}

/** 手动触发一次整理（自动整理已在每轮对话后跑过；此接口用于强制补抽），返回该会话待确认候选。 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ConsolidateBody | null;
  const sessionId = body && body.sessionId != null ? Number(body.sessionId) : NaN;
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  try {
    await consolidateSession(sessionId);
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  const candidates = listCandidates({ sessionId, status: "pending" }).map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    content: c.content,
    importance: c.importance,
    theme: c.theme,
  }));
  return Response.json({ ok: true, candidates, count: candidates.length });
}
