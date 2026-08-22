import {
  setMemoryStatus,
  softDeleteMemory,
  updateImportance,
} from "@/lib/memory/repo";
import { MEMORY_STATUSES, type MemoryStatus } from "@/lib/memory/types";

export const dynamic = "force-dynamic";

interface PatchBody {
  status?: MemoryStatus;
  importance?: number;
}

/** 只允许改状态与重要性；语义内容不可编辑——变更走「新增 + supersede」。 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const memoryId = Number(id);
  if (!Number.isInteger(memoryId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });
  if (body.status && !(MEMORY_STATUSES as readonly string[]).includes(body.status)) {
    return Response.json({ error: `invalid status: ${body.status}` }, { status: 400 });
  }

  if (body.status) setMemoryStatus(memoryId, body.status);
  if (typeof body.importance === "number") {
    updateImportance(memoryId, body.importance);
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const memoryId = Number(id);
  if (!Number.isInteger(memoryId)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  softDeleteMemory(memoryId);
  return Response.json({ ok: true });
}
