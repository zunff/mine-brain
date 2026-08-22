import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";
import { setSetting } from "@/lib/memory/repo";
import { GET } from "@/app/api/export/route";

let dir: string;

beforeEach(() => {
  __resetDbForTests();
  dir = mkdtempSync(path.join(tmpdir(), "mb-export-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("导出隐私：任何 API Key 都不得出现在导出文件中", () => {
  it("全局 apiKey 与角色覆盖 apiKey 全部脱敏为 __REDACTED__", async () => {
    setSetting("ai", {
      baseUrl: "https://global.example/v1",
      apiKey: "sk-global-secret",
      model: "global-model",
      roles: {
        thinker: { model: "t-model", apiKey: "sk-thinker-secret" },
        extractor: { baseUrl: "https://x.example/v1", apiKey: "sk-extractor-secret" },
        embedder: { model: "e-model", apiKey: "sk-embedder-secret", dimensions: 1024 },
      },
    });

    const res = await GET();
    const payload = (await res.json()) as {
      data: { settings: Array<{ key: string; value: string }> };
    };
    const aiRow = payload.data.settings.find((s) => s.key === "ai");
    expect(aiRow).toBeDefined();
    const cfg = JSON.parse(aiRow!.value) as {
      apiKey: string;
      roles: Record<string, { apiKey: string }>;
    };

    expect(cfg.apiKey).toBe("__REDACTED__");
    expect(cfg.roles.thinker.apiKey).toBe("__REDACTED__");
    expect(cfg.roles.extractor.apiKey).toBe("__REDACTED__");
    expect(cfg.roles.embedder.apiKey).toBe("__REDACTED__");
    // 真实密钥绝不出现
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("sk-global-secret");
    expect(raw).not.toContain("sk-thinker-secret");
    expect(raw).not.toContain("sk-extractor-secret");
    expect(raw).not.toContain("sk-embedder-secret");
  });

  it("未配置角色 key 时导出不炸", async () => {
    setSetting("ai", {
      baseUrl: "https://global.example/v1",
      apiKey: "sk-global-secret",
      model: "global-model",
    });
    const res = await GET();
    expect(res.ok).toBe(true);
    const payload = (await res.json()) as {
      data: { settings: Array<{ key: string; value: string }> };
    };
    const aiRow = payload.data.settings.find((s) => s.key === "ai");
    const cfg = JSON.parse(aiRow!.value) as { apiKey: string };
    expect(cfg.apiKey).toBe("__REDACTED__");
  });
});
