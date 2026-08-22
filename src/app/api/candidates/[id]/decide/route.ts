import { embedNewMemories } from "@/lib/memory/consolidate";
import { approveCandidate, getAiSettings, getMemory, rejectCandidate } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

interface DecideBody {
  decision?: string;
}

/** 确认候选（approve）→ 落正式记忆 + 标签 + 关联边 + 向量化；拒绝（reject）→ 标记 rejected。 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const candidateId = Number(id);
  if (!Number.isInteger(candidateId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as DecideBody | null;
  if (!body || (body.decision !== "approve" && body.decision !== "reject")) {
    return Response.json({ error: "decision required: approve|reject" }, { status: 400 });
  }

  try {
    if (body.decision === "approve") {
      const memoryId = approveCandidate(candidateId);
      const m = getMemory(memoryId);
      if (m) await embedNewMemories(getAiSettings(), [{ id: memoryId, content: m.content }]);
      return Response.json({ ok: true, memoryId });
    }
    rejectCandidate(candidateId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
