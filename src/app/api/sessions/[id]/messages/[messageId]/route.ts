import { deleteMessagePair, getSession } from "@/lib/memory/repo";
import { isSessionStreaming } from "@/lib/agent/stream-manager";

export const dynamic = "force-dynamic";

/** 删除一轮问答（用户消息 + 紧随其后的助手回复）。流式生成中拒绝，避免删除中的话轮。 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; messageId: string }> },
): Promise<Response> {
  const { id, messageId } = await ctx.params;
  const sessionId = Number(id);
  const userMessageId = Number(messageId);
  if (!Number.isInteger(sessionId) || !Number.isInteger(userMessageId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  if (!getSession(sessionId)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (isSessionStreaming(sessionId)) {
    return Response.json({ error: "session is streaming" }, { status: 409 });
  }
  const deleted = deleteMessagePair(sessionId, userMessageId);
  if (deleted === 0) {
    return Response.json(
      { error: "message not found or not a user message" },
      { status: 404 },
    );
  }
  return Response.json({ ok: true, deleted });
}