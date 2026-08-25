import { deleteSession, getSession, listMessages, renameSession } from "@/lib/memory/repo";
import { isSessionStreaming } from "@/lib/agent/stream-manager";

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

    let webSources: unknown[] | undefined;
    if (m.web_sources) {
      try {
        const parsed = JSON.parse(m.web_sources);
        if (Array.isArray(parsed)) webSources = parsed;
      } catch {
        /* ignore parse error */
      }
    }

    let retrievedMemories: unknown[] | undefined;
    let retrievedThemes: string[] | undefined;
    let toolTraces: unknown[] | undefined;
    let deepThinking: boolean | undefined;
    let deepResearch: boolean | undefined;
    let researchSteps: unknown[] | undefined;
    if (m.retrieved_memories) {
      try {
        const parsed = JSON.parse(m.retrieved_memories) as {
          themes?: string[];
          memories?: unknown[];
          traces?: unknown[];
          deepThinking?: boolean;
          deepResearch?: boolean;
          research?: unknown[];
        };
        if (Array.isArray(parsed.memories)) retrievedMemories = parsed.memories;
        if (Array.isArray(parsed.themes)) retrievedThemes = parsed.themes;
        if (Array.isArray(parsed.traces)) toolTraces = parsed.traces;
        if (typeof parsed.deepThinking === "boolean") deepThinking = parsed.deepThinking;
        if (typeof parsed.deepResearch === "boolean") deepResearch = parsed.deepResearch;
        if (Array.isArray(parsed.research)) researchSteps = parsed.research;
      } catch {
        /* ignore parse error */
      }
    }

    return {
      ...m,
      reasoning_content: m.reasoning ?? undefined,
      images,
      webSources: webSources && webSources.length > 0 ? webSources : undefined,
      retrievedMemories:
        retrievedMemories && retrievedMemories.length > 0 ? retrievedMemories : undefined,
      retrievedThemes:
        retrievedThemes && retrievedThemes.length > 0 ? retrievedThemes : undefined,
      toolTraces: toolTraces && toolTraces.length > 0 ? toolTraces : undefined,
      deepThinking,
      deepResearch,
      researchSteps: researchSteps && researchSteps.length > 0 ? researchSteps : undefined,
    };
  });
  const isStreaming = isSessionStreaming(sessionId);
  return Response.json({ session, messages, isStreaming });
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
  renameSession(sessionId, body.title.trim().slice(0, 60));
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
  // 后台常驻流仍在写入该会话时拒绝删除，避免僵尸写指向已删除的会话
  if (isSessionStreaming(sessionId)) {
    return Response.json({ error: "session is streaming" }, { status: 409 });
  }
  deleteSession(sessionId);
  return Response.json({ ok: true });
}
