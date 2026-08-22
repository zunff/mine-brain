import { getAiSettings, setSetting } from "@/lib/memory/repo";
import type { AiSettings } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "*".repeat(key.length);
  return key.slice(0, 6) + "…" + key.slice(-4);
}

export async function GET(): Promise<Response> {
  const s = getAiSettings();
  return Response.json({
    baseUrl: s.baseUrl,
    apiKeyMasked: maskKey(s.apiKey),
    hasApiKey: Boolean(s.apiKey),
    model: s.model,
    roles: s.roles ?? {},
    source: process.env.MINE_BRAIN_AI_API_KEY ? "env+db" : "db/default",
  });
}

interface PutBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 角色级覆盖；空串表示清除覆盖回退默认模型 */
  roles?: Partial<Record<"thinker" | "extractor" | "embedder", string>>;
}

/** 空字符串的 apiKey 表示「不改」。 */
export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PutBody | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });
  const current = getAiSettings();
  const roles = { ...(current.roles ?? {}) };
  for (const [role, model] of Object.entries(body.roles ?? {})) {
    const m = (model ?? "").trim();
    if (m) {
      roles[role as keyof typeof roles] = { model: m };
    } else {
      delete roles[role as keyof typeof roles];
    }
  }
  const next: AiSettings = {
    baseUrl: body.baseUrl?.trim() || current.baseUrl,
    apiKey: body.apiKey?.trim() ? body.apiKey.trim() : current.apiKey,
    model: body.model?.trim() || current.model,
    roles,
  };
  setSetting("ai", next);
  return Response.json({ ok: true, apiKeyMasked: maskKey(next.apiKey) });
}
