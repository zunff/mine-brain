import { getAiSettings, setSetting } from "@/lib/memory/repo";
import { embedderReady, embedderRuntime, type AiSettings } from "@/lib/providers/registry";
import type { AgentRole, RoleOverride } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const ROLES: AgentRole[] = ["thinker", "extractor", "embedder"];

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "*".repeat(key.length);
  return key.slice(0, 6) + "…" + key.slice(-4);
}

function maskOverride(o?: RoleOverride): RoleOverride | undefined {
  if (!o) return undefined;
  return {
    model: o.model,
    baseUrl: o.baseUrl,
    apiKey: o.apiKey ? maskKey(o.apiKey) : undefined,
    dimensions: o.dimensions,
  };
}

export async function GET(): Promise<Response> {
  const s = getAiSettings();
  const rt = embedderRuntime(s);
  return Response.json({
    baseUrl: s.baseUrl,
    apiKeyMasked: maskKey(s.apiKey),
    hasApiKey: Boolean(s.apiKey),
    model: s.model,
    roles: Object.fromEntries(
      ROLES.map((r) => [r, maskOverride(s.roles?.[r])]),
    ),
    // embedder 生效配置与可用性：切换模型/维度后点「重新向量化」
    embedder: rt
      ? {
          model: rt.model,
          baseUrl: rt.baseUrl,
          dimensions: rt.dimensions,
          ready: embedderReady(s),
          hasApiKey: Boolean(rt.apiKey),
        }
      : null,
  });
}

interface PutBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 角色覆盖；字段空串=清除该字段；三字段全空=删除该角色覆盖 */
  roles?: Partial<Record<AgentRole, Partial<RoleOverride>>>;
}

/** 空字符串的 apiKey 表示「不改」。 */
export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });
  const current = getAiSettings();

  const roles: AiSettings["roles"] = { ...(current.roles ?? {}) };
  for (const role of ROLES) {
    const incoming = body.roles?.[role];
    if (!incoming) continue;
    const merged: RoleOverride = {
      ...roles[role],
      ...(incoming.model !== undefined && { model: incoming.model.trim() }),
      ...(incoming.baseUrl !== undefined && { baseUrl: incoming.baseUrl.trim() }),
      ...(incoming.apiKey !== undefined &&
        incoming.apiKey.trim() !== "" && { apiKey: incoming.apiKey.trim() }),
    };
    // 清理空串字段
    for (const k of ["model", "baseUrl", "apiKey"] as const) {
      if (merged[k] === "") delete merged[k];
    }
    // apiKey 显式传空且原为掩码占位时不动；传 "__CLEAR__" 表示清除
    if (incoming.apiKey === "__CLEAR__") delete merged.apiKey;
    if (Object.keys(merged).length === 0) {
      delete roles[role];
    } else {
      roles[role] = merged;
    }
  }

  const next: AiSettings = {
    baseUrl: body.baseUrl?.trim() || current.baseUrl,
    apiKey: body.apiKey?.trim() ? body.apiKey.trim() : current.apiKey,
    model: body.model?.trim() || current.model,
    roles,
  };
  setSetting("ai", next);
  return Response.json({ ok: true });
}
