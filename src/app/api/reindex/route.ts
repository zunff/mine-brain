import { embedderReady, embedderRuntime, resolveEmbedder } from "@/lib/providers/registry";
import { embeddingsMissingCount, getAiSettings, listMemories, setMemoryEmbedding } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CHUNK = 20;

/**
 * 重新向量化：为缺失当前 embedding 模型向量的 active 记忆批量嵌入。
 * 切换模型/维度后在设置页点一次即可（旧向量按 model 匹配自动失效，不参与打分）。
 */
export async function POST(): Promise<Response> {
  const settings = getAiSettings();
  if (!embedderReady(settings)) {
    return Response.json(
      { ok: false, error: "embedder 未配置或缺少 API Key，请先到设置页配置。" },
      { status: 400 },
    );
  }
  const rt = embedderRuntime(settings)!;
  const provider = resolveEmbedder(settings);

  const actives = listMemories({ limit: 100000 });
  const missing = embeddingsMissingCount(actives.map((m) => m.id), rt.model, rt.dimensions);
  if (missing === 0) {
    return Response.json({ ok: true, total: actives.length, done: 0, skipped: true });
  }

  let done = 0;
  try {
    for (let i = 0; i < actives.length; i += CHUNK) {
      const chunk = actives.slice(i, i + CHUNK);
      const need = chunk.filter(
        (m) => !m.deleted_at && m.status === "active",
      );
      if (need.length === 0) continue;
      const texts = need.map((m) => (m.content || m.title).slice(0, 4000));
      if (!provider?.embed) {
        return Response.json({ ok: false, error: "embedder 不支持 embeddings" }, { status: 400 });
      }
      const vectors = await provider.embed(texts, { dimensions: rt.dimensions });
      for (let j = 0; j < need.length; j++) {
        const v = vectors[j];
        if (!v) continue;
        setMemoryEmbedding(need[j].id, rt.model, v.length, new Float32Array(v));
        done++;
      }
    }
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err), done },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, total: actives.length, done });
}
