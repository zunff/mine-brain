import { listSessions } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ sessions: listSessions() });
}
