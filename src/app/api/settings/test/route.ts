import { resolveProvider } from "@/lib/providers/registry";
import { getAiSettings } from "@/lib/memory/repo";
import { ProviderError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** 连接测试：发一个最小请求验证 baseUrl/key/model 三件套。 */
export async function POST(): Promise<Response> {
  const settings = getAiSettings();
  if (!settings.apiKey) {
    return Response.json({ ok: false, error: "未配置 API Key" }, { status: 400 });
  }
  try {
    const provider = resolveProvider(settings, "thinker");
    const res = await provider.chat(
      [{ role: "user", content: "回复：连接成功" }],
      { maxTokens: 2000, temperature: 0 },
    );
    return Response.json({
      ok: true,
      model: res.model,
      reply: res.content.slice(0, 50),
    });
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : undefined;
    return Response.json(
      {
        ok: false,
        status,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 502 },
    );
  }
}
