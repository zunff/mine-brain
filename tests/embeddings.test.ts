import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests, getDb } from "@/lib/db/client";
import {
  embeddingsFor,
  embeddingsMissingCount,
  insertMemory,
  setMemoryEmbedding,
} from "@/lib/memory/repo";
import { buildContextBundle } from "@/lib/memory/retrieve";
import { resolveProvider } from "@/lib/providers/registry";
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible";

let dir: string;
const origFetch = globalThis.fetch;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mb-emb-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});
afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = origFetch;
});
beforeEach(() => {
  __resetDbForTests();
  const fresh = mkdtempSync(path.join(tmpdir(), "mb-embcase-"));
  process.env.MINE_BRAIN_DATA_DIR = fresh;
  dir = fresh;
});

describe("memory_embeddings 存储", () => {
  function seedMemory(content: string, theme?: string) {
    return insertMemory({ type: "claim", content, importance: 0.5, theme: theme ?? null });
  }

  it("按 (model, dims) 存向量并可读回，Float32 无损", () => {
    const id = seedMemory("我在纠结要不要换工作");
    const v = new Float32Array([0.1, 0.2, 0.3]);
    setMemoryEmbedding(id, "qwen3.7-text-embedding", 3, v);
    const rows = embeddingsFor("qwen3.7-text-embedding");
    expect(rows).toHaveLength(1);
    expect(rows[0].dims).toBe(3);
    // float32 精度：与原始 Float32Array 位级一致即可
    expect([...rows[0].vector]).toEqual([...new Float32Array([0.1, 0.2, 0.3])]);
  });

  it("不同模型的向量互不干扰（跨模型不互通）", () => {
    const id = seedMemory("测试");
    setMemoryEmbedding(id, "modelA", 3, new Float32Array([1, 2, 3]));
    setMemoryEmbedding(id, "modelB", 3, new Float32Array([4, 5, 6]));
    // 同一条记忆只保留最新 model 的向量
    expect(embeddingsFor("modelA")).toHaveLength(0);
    expect(embeddingsFor("modelB")).toHaveLength(1);
  });

  it("同记忆重复嵌入会覆盖旧向量（重嵌语义）", () => {
    const id = seedMemory("覆盖测试");
    setMemoryEmbedding(id, "m", 2, new Float32Array([1, 1]));
    setMemoryEmbedding(id, "m", 2, new Float32Array([9, 9]));
    expect([...embeddingsFor("m")[0].vector]).toEqual([9, 9]);
  });

  it("embeddingsMissingCount 只统计当前 (model,dims) 缺失的 active 记忆", () => {
    const a = seedMemory("有向量");
    const b = seedMemory("缺向量");
    setMemoryEmbedding(a, "m", 2, new Float32Array([1, 1]));
    expect(embeddingsMissingCount([a, b], "m", 2)).toBe(1);
    expect(embeddingsMissingCount([a, b], "other", 2)).toBe(2);
    // 同模型改维度 = 换向量空间，旧向量不算数，必须重嵌
    expect(embeddingsMissingCount([a, b], "m", 3)).toBe(2);
  });
});

describe("向量作为第 5 条检索信号（buildContextBundle + vectorBoostById）", () => {
  it("语义相关但词法零命中的记忆，靠向量分进入 related", () => {
    const id = insertMemory({
      type: "claim",
      content: "我最近想换个环境重新开始",
      importance: 0.3,
      theme: null,
      // 无标签、无生活域命中、低重要性 → 词法通道不达标
    });
    const bundle = buildContextBundle("关于跳槽我想聊聊", {
      vectorBoostById: new Map([[id, 1.8]]),
    });
    expect(bundle.related.some((m) => m.id === id)).toBe(true);
  });

  it("向量分不足以挽救语义无关的记忆；有词法命中时兜底不触发", () => {
    // 相关记忆：有标签命中 → scored 非空 → 兜底不触发
    const relevant = insertMemory({ type: "claim", content: "跳槽的利弊", importance: 0.7, theme: "career" });
    // 无关记忆：低重要性、40 天前、低向量分 → 不达阈值
    const irrelevant = insertMemory({ type: "claim", content: "明天去超市买鸡蛋", importance: 0.3, theme: null });
    const stale = new Date(Date.now() - 40 * 86400000).toISOString();
    getDb()
      .prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(stale, stale, irrelevant);
    const bundle = buildContextBundle("聊聊换工作", {
      vectorBoostById: new Map([[irrelevant, 0.35]]),
    });
    expect(bundle.related.some((m) => m.id === relevant)).toBe(true);
    expect(bundle.related.some((m) => m.id === irrelevant)).toBe(false);
  });
});

describe("OpenAICompatibleProvider.embed（stub fetch）", () => {
  it("POST /embeddings 并按 opts.dimensions 透传", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(input), body });
      return new Response(JSON.stringify({ data: [{ embedding: [0.25, 0.5, 0.75] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-test",
      model: "qwen3.7-text-embedding",
    });
    const vecs = await provider.embed(["你好"], { dimensions: 1024 });
    expect(vecs[0]).toEqual([0.25, 0.5, 0.75]);
    expect(calls[0].url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
    expect(calls[0].body.dimensions).toBe(1024);
    expect(calls[0].body.model).toBe("qwen3.7-text-embedding");
  });

  it("非 2xx 时抛 ProviderError，不吞错（调用方自行降级）", async () => {
    globalThis.fetch = (async () =>
      new Response("Required body invalid", { status: 400 })) as typeof fetch;
    const provider = resolveProvider(
      {
        baseUrl: "https://x.example/v1",
        apiKey: "k",
        model: "m",
        roles: { embedder: { model: "emb", baseUrl: "https://x.example/v1", apiKey: "k" } },
      },
      "embedder",
    );
    await expect(provider.embed!(["hi"])).rejects.toThrow();
  });
});
