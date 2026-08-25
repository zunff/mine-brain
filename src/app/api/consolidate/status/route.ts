import { isConsolidatedUpToDate } from "@/lib/memory/consolidate";
import { listCandidates } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/consolidate/status?sessionId=123
 * 瞬间返回该会话后端整理是否已「追平」（consolidate 结束且最新消息已消化）及当前待确认候选。
 * 不阻塞请求：由前端以约 1.5s 间隔轮询这个轻量端点，直到 done 或拿满候选为止。
 * 相比「一次挂 30 秒的长轮询」，每个请求瞬时返回、不占路由槽、不怕宿主超时，是完成信号驱动的推动式。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawId = url.searchParams.get("sessionId");
  const sessionId = rawId != null && rawId !== "" ? Number(rawId) : NaN;
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const candidates = listCandidates({ sessionId, status: "pending" }).map((c) => ({
    id: c.id,
    type: c.type,
    title: c.title,
    content: c.content,
    importance: c.importance,
    theme: c.theme,
  }));
  return Response.json({
    ok: true,
    done: isConsolidatedUpToDate(sessionId),
    candidates,
    count: candidates.length,
  });
}