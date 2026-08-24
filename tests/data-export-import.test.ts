import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";
import { buildExportPayload, type ExportPayload } from "@/lib/data/export";
import { importPayload } from "@/lib/data/import";
import {
  addEntry,
  createSession,
  getAiSettings,
  insertCandidate,
  insertMemory,
  listCandidates,
  listMemories,
  setMemoryEmbedding,
  setSetting,
} from "@/lib/memory/repo";
import { embeddingsFor } from "@/lib/memory/repo";

let dir: string;

beforeEach(() => {
  __resetDbForTests();
  dir = mkdtempSync(path.join(tmpdir(), "mb-data-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

function seedRichDataset() {
  const sessionId = createSession("往返测试").id;
  const entryId = addEntry("chat", "一次关于选择的对话", sessionId);
  const memId = insertMemory({
    type: "claim",
    content: "往返后也要保留这条主张",
    importance: 0.8,
    sourceEntryId: entryId,
    sessionId,
  });
  insertCandidate({ type: "question", content: "稳定 vs 探索" }, entryId, sessionId);
  const vec = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
  setMemoryEmbedding(memId, "test-model", 5, vec);
  setSetting("ai", {
    baseUrl: "https://x.example/v1",
    apiKey: "sk-real-secret",
    model: "m",
  });
  return { sessionId, memId, entryId };
}

describe("导出→导入往返：数据主权闭环", () => {
  it("候选暂存与向量索引都进导出，JSON 往返后无损恢复", () => {
    seedRichDataset();

    const payload = buildExportPayload();
    expect(payload.data.memory_candidates.length).toBe(1);
    expect(payload.data.memory_embeddings.length).toBe(1);

    // 模拟「存文件再读回」：向量 BLOB 必须能 JSON 序列化（b64 字符串）
    const roundtrip = JSON.parse(JSON.stringify(payload)) as ExportPayload;
    expect(typeof roundtrip.data.memory_embeddings[0].vector).toBe("string");

    const result = importPayload(roundtrip);
    expect(result.counts.memories).toBe(1);
    expect(result.counts.memory_candidates).toBe(1);
    expect(result.counts.memory_embeddings).toBe(1);

    expect(listMemories()[0].content).toBe("往返后也要保留这条主张");
    expect(listCandidates({ status: "pending" }).length).toBe(1);
    const stored = embeddingsFor("test-model");
    expect(stored.length).toBe(1);
    // 同一份 Float32Array 两份值逐字节一致，证明 BLOB base64 往返无损
    expect(Array.from(stored[0].vector)).toEqual(
      Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])),
    );
  });

  it("密钥不随导出泄漏；导入后本地真实配置保留", () => {
    seedRichDataset();
    const raw = JSON.stringify(buildExportPayload());
    expect(raw).not.toContain("sk-real-secret");

    importPayload(JSON.parse(raw) as ExportPayload);
    expect(getAiSettings().apiKey).toBe("sk-real-secret");
  });

  it("旧版导出缺少两张新表时仍能恢复（按空表处理）", () => {
    seedRichDataset();
    const payload = JSON.parse(JSON.stringify(buildExportPayload())) as ExportPayload;
    delete payload.data.memory_candidates;
    delete payload.data.memory_embeddings;

    const result = importPayload(payload);
    expect(result.counts.memories).toBe(1);
    expect(listMemories().length).toBe(1);
    expect(listCandidates({ status: "pending" }).length).toBe(0);
  });

  it("非法文件（非 mine-brain 结构）被拒且原数据不动", () => {
    const before = listMemories().length;
    expect(() =>
      importPayload({ app: "other", version: 1, data: {} }),
    ).toThrow();
    expect(listMemories().length).toBe(before);
  });
});