import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/settings/route";
import { buildTestPlan } from "@/app/api/settings/test/route";
import { __resetDbForTests } from "@/lib/db/client";
import type { AiSettings } from "@/lib/providers/registry";

// 回归：设置页「只改全局后保存」曾把已配置的角色覆盖发成空串清掉。
// 这类清空的根因在前端载荷形状（已修），后端合并语义（空=清除、apiKey 空=不改、__CLEAR__=清除）
// 是这条链路的另一半契约，在此固化。
let dir: string;

async function doPut(body: unknown): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
interface SettingsGetShape {
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  model: string;
  roles: Record<string, { model?: string; baseUrl?: string; apiKey?: string; dimensions?: number } | undefined>;
}
type RoleShape = NonNullable<SettingsGetShape["roles"][string]>;
function role(s: SettingsGetShape, key: string): RoleShape {
  return s.roles[key]!;
}
async function getJson(): Promise<SettingsGetShape> {
  const res = await GET();
  return res.json();
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mb-settings-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
  // 与 .env.local 隔离，保证断言只反映本测试写入的值，不随本机密钥漂移
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("MINE_BRAIN_AI_") || k.startsWith("MINE_BRAIN_EMBED_") || k.startsWith("MINE_BRAIN_SEARCH_")) {
      delete process.env[k];
    }
  }
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINE_BRAIN_DATA_DIR;
});

describe("/api/settings PUT 合并语义", () => {
  it("新增完整配置：全局 + thinker/extractor/embedder/searcher 覆盖全部落库", async () => {
    const res = await doPut({
      baseUrl: "http://global.local/v1",
      apiKey: "sk-global",
      model: "g-model",
      roles: {
        thinker: { model: "deepseek-r1", baseUrl: "http://t.local/v1", apiKey: "sk-t" },
        extractor: { model: "", baseUrl: "", apiKey: "sk-e" },
        embedder: { model: "qwen3.7-text-embedding", baseUrl: "http://e.local/v1", apiKey: "sk-em", dimensions: "1024" },
        searcher: { baseUrl: "http://exa.local", apiKey: "sk-s" },
      },
    });
    expect(res.status).toBe(200);

    const s = await getJson();
    expect(s.model).toBe("g-model");
    expect(s.baseUrl).toBe("http://global.local/v1");
    expect(s.hasApiKey).toBe(true);
    expect(role(s, "thinker")).toMatchObject({ model: "deepseek-r1", baseUrl: "http://t.local/v1" });
    expect(role(s, "thinker").apiKey).toBeTruthy();
    expect(role(s, "thinker").apiKey).not.toBe("sk-t"); // GET 只回掩码
    expect(role(s, "extractor").apiKey).toBeTruthy();
    expect(role(s, "embedder")).toMatchObject({ model: "qwen3.7-text-embedding", dimensions: 1024 });
    expect(role(s, "searcher").baseUrl).toBe("http://exa.local");
  });

  it("只改全局模型时保存，已配置的覆盖不受影响（修复：曾发成空串被清掉）", async () => {
    // 模拟新前端：覆盖输入框载入已存值，apiKey 一律留空（=不改）
    const res = await doPut({
      baseUrl: "http://global.local/v1",
      apiKey: "",
      model: "g-model-2",
      roles: {
        thinker: { model: "deepseek-r1", baseUrl: "http://t.local/v1", apiKey: "" },
        extractor: { model: "", baseUrl: "", apiKey: "" },
        embedder: { model: "qwen3.7-text-embedding", baseUrl: "http://e.local/v1", apiKey: "", dimensions: "1024" },
        searcher: { baseUrl: "http://exa.local", apiKey: "" },
      },
    });
    expect(res.status).toBe(200);

    const s = await getJson();
    expect(s.model).toBe("g-model-2"); // 全局改动生效
    expect(s.hasApiKey).toBe(true); // 全局 key 留空 → 保留
    expect(role(s, "thinker")).toMatchObject({ model: "deepseek-r1", baseUrl: "http://t.local/v1" });
    expect(role(s, "thinker").apiKey).toBeTruthy(); // 覆盖的 key 不被空串误清
    expect(role(s, "extractor").apiKey).toBeTruthy();
    expect(role(s, "embedder")).toMatchObject({ model: "qwen3.7-text-embedding", baseUrl: "http://e.local/v1", dimensions: 1024 });
    expect(role(s, "embedder").apiKey).toBeTruthy();
    expect(role(s, "searcher").baseUrl).toBe("http://exa.local");
    expect(role(s, "searcher").apiKey).toBeTruthy();
  });

  it("重置单个角色：空字段 + __CLEAR__ 只清该角色，其余角色与全局不受影响", async () => {
    const res = await doPut({
      roles: { thinker: { model: "", baseUrl: "", apiKey: "__CLEAR__" } },
    });
    expect(res.status).toBe(200);

    const s = await getJson();
    expect(role(s, "thinker")).toBeUndefined(); // 整个覆盖清掉 → 恢复继承全局
    expect(role(s, "extractor").apiKey).toBeTruthy(); // 别的角色不动
    expect(s.model).toBe("g-model-2"); // 全局不动
    expect(s.hasApiKey).toBe(true);
  });

  it("全局字段留空是「不改」而非清空", async () => {
    const before = await getJson();
    await doPut({ baseUrl: "", model: "" });
    const after = await getJson();
    expect(after.baseUrl).toBe(before.baseUrl);
    expect(after.model).toBe(before.model);
    expect(after.hasApiKey).toBe(true);
  });

  it("每卡片独立保存：只写全局字段不触碰角色覆盖", async () => {
    await doPut({ model: "g-model-3" });
    const s = await getJson();
    expect(s.model).toBe("g-model-3");
    expect(s.hasApiKey).toBe(true); // 全局 key 空 → 保留
    expect(role(s, "extractor").apiKey).toBeTruthy(); // 其余卡片覆盖原样
    expect(role(s, "embedder").model).toBe("qwen3.7-text-embedding");
    expect(role(s, "searcher").baseUrl).toBe("http://exa.local");
  });
});

describe("buildTestPlan 连接探针选择与跳过判断（离线）", () => {
  const stored: AiSettings = {
    baseUrl: "http://global/v1",
    apiKey: "sk-global",
    model: "g-model",
  };

  it("global：只探纯全局配置，忽略角色覆盖；无 key 跳过", () => {
    const p = buildTestPlan(stored, {}, "global");
    expect(p).toMatchObject({
      ok: true,
      plan: { kind: "chat", cfg: { baseUrl: "http://global/v1", apiKey: "sk-global", model: "g-model" } },
    });
    expect(buildTestPlan({ ...stored, apiKey: "" }, {}, "global")).toEqual({
      ok: false,
      skipped: true,
      error: "全局未配置 API Key",
    });
  });

  it("thinker/extractor：草稿覆盖参与生效配置；全局与角色都无 key 才跳过", () => {
    const p = buildTestPlan(
      stored,
      { roles: { thinker: { model: "deepseek-r1", baseUrl: "http://t/v1", apiKey: "sk-t" } } },
      "thinker",
    );
    expect(p).toMatchObject({
      ok: true,
      plan: { kind: "chat", cfg: { model: "deepseek-r1", baseUrl: "http://t/v1", apiKey: "sk-t" } },
    });
    expect(
      buildTestPlan(
        { ...stored, apiKey: "" },
        { roles: { extractor: { model: "mini" } } },
        "extractor",
      ),
    ).toEqual({ ok: false, skipped: true, error: "「extractor」未配置 API Key" });
  });

  it("embedder：默认 qwen 模型 + 全局 key 兜底即可探针；无任何 key 时跳过", () => {
    // 未显式配置时 env 默认指向 qwen 模型，embedder 探针的可用前提只剩 key
    const def = buildTestPlan(stored, {}, "embedder");
    expect(def).toMatchObject({ ok: true, plan: { kind: "embed", dimensions: 1024 } });
    const p = buildTestPlan(
      stored,
      { roles: { embedder: { model: "bge-m3", baseUrl: "http://e/v1", apiKey: "sk-e", dimensions: 768 } } },
      "embedder",
    );
    expect(p).toMatchObject({ ok: true, plan: { kind: "embed", dimensions: 768 } });
    expect(buildTestPlan({ ...stored, apiKey: "" }, {}, "embedder")).toEqual({
      ok: false,
      skipped: true,
      error: "embedder 未配置 API Key",
    });
  });

  it("searcher：key 只认专属来源（角色覆盖/env），绝不回退全局 key", () => {
    expect(buildTestPlan(stored, {}, "searcher")).toEqual({
      ok: false,
      skipped: true,
      error: "searcher 未配置 API Key",
    });
    const p = buildTestPlan(
      stored,
      { roles: { searcher: { baseUrl: "http://s/v1", apiKey: "sk-s" } } },
      "searcher",
    );
    expect(p).toMatchObject({
      ok: true,
      plan: { kind: "search", cfg: { baseUrl: "http://s/v1", apiKey: "sk-s" } },
    });
  });
});