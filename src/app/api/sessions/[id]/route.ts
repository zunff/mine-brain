import { getDb, nowIso } from "@/lib/db/client";
import { getSession, listMessages } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const session = getSession(sessionId);
  if (!session) return Response.json({ error: "not found" }, { status: 404 });
  const rawMessages = listMessages(sessionId);
  const messages = rawMessages.map((m) => {
    let images: string[] = [];
    if (m.images) {
      try {
        const parsed = JSON.parse(m.images);
        if (Array.isArray(parsed)) images = parsed;
        else if (typeof parsed === "string") images = [parsed];
      } catch {
        if (typeof m.images === "string" && (m.images.startsWith("data:") || m.images.startsWith("http"))) {
          images = [m.images];
        }
      }
    }
    return { ...m, images };
  });
  return Response.json({ session, messages });
}

interface PatchBody {
  title?: string;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!Number.isInteger(sessionId) || !body?.title?.trim()) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  getDb()
    .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
    .run(body.title.trim().slice(0, 60), nowIso(), sessionId);
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  // messages 级联删除；entries/memories 是长期资产，保留但解除关联
  getDb()
    .prepare("UPDATE entries SET session_id = NULL WHERE session_id = ?")
    .run(sessionId);
  getDb()
    .prepare("UPDATE memories SET session_id = NULL WHERE session_id = ?")
    .run(sessionId);
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return Response.json({ ok: true });
}
