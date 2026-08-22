import { listSessions, createSession } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ sessions: listSessions() });
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = body.title?.trim() || "新对话";
  const session = createSession(title);
  return Response.json({ session });
}
