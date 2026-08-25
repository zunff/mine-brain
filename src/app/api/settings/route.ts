import { getAiSettings, setSetting } from "@/lib/memory/repo";
import {
  embedderReady,
  embedderRuntime,
  mergeSettingsPatch,
  searcherRuntime,
  type SettingsPatch,
} from "@/lib/providers/registry";
import type { AgentRole, RoleOverride } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const ROLES: AgentRole[] = ["thinker", "extractor", "embedder", "searcher"];

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
  const srt = searcherRuntime(s);
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
    // 联网搜索生效配置与可用性：ready 时聊天输入框才出现「联网」开关
    searcher: srt ? { baseUrl: srt.baseUrl, ready: true } : null,
  });
}

/** 空字符串的 apiKey 表示「不改」。合并语义见 registry.mergeSettingsPatch。 */
export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as SettingsPatch | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });
  setSetting("ai", mergeSettingsPatch(getAiSettings(), body));
  return Response.json({ ok: true });
}
