import { describe, expect, it } from "vitest";
import { resolveEmbedder, resolveProvider, type AiSettings } from "@/lib/providers/registry";

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

describe("resolveEmbedder 可选能力", () => {
  it("未配置 embedder 模型时返回 null（调用方必须降级）", () => {
    expect(resolveEmbedder(base)).toBeNull();
    expect(resolveEmbedder({ ...base, roles: { embedder: { apiKey: "k" } } })).toBeNull();
  });

  it("配置后返回独立 provider，支持指向另一家", () => {
    const e = resolveEmbedder({
      ...base,
      roles: {
        embedder: { model: "bge-m3", baseUrl: "https://local.example/v1" },
      },
    });
    expect(e).not.toBeNull();
    expect(e!.config.model).toBe("bge-m3");
    expect(e!.config.baseUrl).toBe("https://local.example/v1");
    expect(e!.config.apiKey).toBe("sk-global");
  });
});
