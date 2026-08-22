import { addEntry, insertMemory, listMemories, setTags } from "@/lib/memory/repo";
import type { MemoryType, MemoryStatus } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") as MemoryType | null;
  const theme = url.searchParams.get("theme");
  const includeInactive = url.searchParams.get("all") === "1";
  return Response.json({
    memories: listMemories({
      type: type ?? undefined,
      theme: theme ?? undefined,
      includeInactive,
    }),
  });
}

interface PostBody {
  type?: MemoryType;
  title?: string;
  content?: string;
  importance?: number;
  theme?: string;
  tags?: string[];
}

/** 手动补录一条记忆（记忆页的「记一笔」）。 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body?.content?.trim()) {
    return Response.json({ error: "content required" }, { status: 400 });
  }
  const entryId = addEntry("journal", body.content.trim());
  const id = insertMemory({
    type: body.type ?? "claim",
    title: body.title?.slice(0, 80),
    content: body.content.trim().slice(0, 2000),
    importance: typeof body.importance === "number" ? body.importance : 0.6,
    theme: body.theme ?? null,
    sourceEntryId: entryId,
    status: "active" as MemoryStatus,
  });
  if (Array.isArray(body.tags)) setTags(id, body.tags);
  return Response.json({ id }, { status: 201 });
}
