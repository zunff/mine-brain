import { afterEach, describe, expect, it } from "vitest";
import {
  embedderReady,
  resolveEmbedder,
  resolveProvider,
  type AiSettings,
} from "@/lib/providers/registry";

afterEach(() => {
  delete process.env.MINE_BRAIN_EMBED_MODEL;
  delete process.env.MINE_BRAIN_EMBED_API_KEY;
});

const base: AiSettings = {
  baseUrl: "https://global.example/v1",
  apiKey: "sk-global",
  model: "global-model",
};

describe("resolveProvider 角色解析", () => {
  it("无覆盖时回退全局三项配置", () => {
    const p = resolveProvider(base, "thinker");
    expect(p.config).toEqual({
      baseUrl: "https://global.example/v1",
      apiKey: "sk-global",
      model: "global-model",
    });
  });

  it("角色只覆盖 model，其余沿用全局", () => {
    const p = resolveProvider(
      { ...base, roles: { thinker: { model: "claude-sonnet-5" } } },
      "thinker",
    );
    expect(p.config.model).toBe("claude-sonnet-5");
    expect(p.config.baseUrl).toBe("https://global.example/v1");
    expect(p.config.apiKey).toBe("sk-global");
  });

  it("角色可整体指向另一家服务商（baseUrl+apiKey+model）", () => {
    const p = resolveProvider(
      {
        ...base,
        roles: {
          extractor: {
            baseUrl: "https://other.example/v1",
            apiKey: "sk-other",
            model: "other-model",
          },
        },
      },
      "extractor",
    );
    expect(p.config).toEqual({
      baseUrl: "https://other.example/v1",
      apiKey: "sk-other",
      model: "other-model",
    });
  });

  it("角色间互不影响：thinker 的覆盖不泄漏给 extractor", () => {
    const settings = { ...base, roles: { thinker: { model: "t-model" } } };
    expect(resolveProvider(settings, "extractor").config.model).toBe("global-model");
  });

  it("空串覆盖视为未覆盖，回退全局", () => {
    const p = resolveProvider(
      { ...base, roles: { thinker: { model: "", baseUrl: "" } } },
      "thinker",
    );
    expect(p.config.model).toBe("global-model");
    expect(p.config.baseUrl).toBe("https://global.example/v1");
  });
});

describe("resolveEmbedder 可选能力（默认走 env，无 env 且无角色覆盖才为 null）", () => {
  it("默认指向 env 的 embedding 模型（qwen3.7-text-embedding）", () => {
    const e = resolveEmbedder(base);
    expect(e).not.toBeNull();
    expect(e!.config.model).toBe("qwen3.7-text-embedding");
  });

  it("embedderReady 是真正的降级闸门：任何来源（角色/env/全局）缺 key 即 false", () => {
    // 全局有 key → 就绪
    expect(embedderReady(base)).toBe(true);
    // 全局无 key 且无 env → 就绪为 false（检索据此跳过向量信号）
    delete process.env.MINE_BRAIN_EMBED_API_KEY;
    expect(embedderReady({ ...base, apiKey: "" })).toBe(false);
    // env 提供 key → 就绪
    process.env.MINE_BRAIN_EMBED_API_KEY = "sk-x";
    expect(embedderReady({ ...base, apiKey: "" })).toBe(true);
  });

  it("角色覆盖可整体指向另一家（model/baseUrl/apiKey），且优先级高于 env 默认", () => {
    const e = resolveEmbedder({
      ...base,
      roles: {
        embedder: { model: "bge-m3", baseUrl: "https://local.example/v1", apiKey: "sk-local" },
      },
    });
    expect(e!.config.model).toBe("bge-m3");
    expect(e!.config.baseUrl).toBe("https://local.example/v1");
    expect(e!.config.apiKey).toBe("sk-local");
  });
});
