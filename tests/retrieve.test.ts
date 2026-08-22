import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests, getDb } from "@/lib/db/client";
import {
  insertMemory,
  linkMemories,
  listMemories,
  setMemoryStatus,
  setTags,
  supersedeMemory,
} from "@/lib/memory/repo";
import { buildContextBundle, extractSignals } from "@/lib/memory/retrieve";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mb-test-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // 每个用例独立库：重置单例并指向全新目录
  __resetDbForTests();
  const fresh = mkdtempSync(path.join(tmpdir(), "mb-case-"));
  process.env.MINE_BRAIN_DATA_DIR = fresh;
  dir = fresh;
});

describe("extractSignals", () => {
  it("从消息中提取标签命中（子串匹配）与生活域", () => {
    const { tags, themes } = extractSignals("我最近在纠结要不要换工作", [
      "换工作",
      "纠结",
      "健身",
    ]);
    expect(tags).toContain("换工作");
    expect(tags).not.toContain("健身");
    expect(themes).toContain("career");
  });
});

describe("buildContextBundle", () => {
  function seed() {
    const profileId = insertMemory({
      type: "profile",
      title: "我是谁",
      content: "我是一个偏理性的人",
      importance: 0.95,
      theme: "self",
    });
    const valueId = insertMemory({
      type: "value",
      title: "价值观",
      content: "成长第一",
      importance: 0.9,
      theme: "meaning",
    });
    const jobClaimId = insertMemory({
      type: "claim",
      title: "想换工作",
      content: "我想换工作因为没成长",
      importance: 0.8,
      theme: "career",
    });
    setTags(jobClaimId, ["换工作", "成长"]);
    return { profileId, valueId, jobClaimId };
  }

  it("宪章切片始终包含 active 的 profile 与 value", () => {
    seed();
    const bundle = buildContextBundle("随便聊聊");
    expect(bundle.constitution.map((m) => m.type)).toContain("profile");
    expect(bundle.constitution.map((m) => m.type)).toContain("value");
  });

  it("标签命中的记忆进入 related，矛盾记忆进入 tensions", () => {
    const { jobClaimId } = seed();
    // 对立立场：不换派
    const stayClaimId = insertMemory({
      type: "claim",
      title: "决定留下",
      content: "稳定和确定性才是第一位，我不换了",
      importance: 0.85,
      theme: "career",
    });
    setTags(stayClaimId, ["稳定"]);
    linkMemories(jobClaimId, stayClaimId, "contradicts");

    const bundle = buildContextBundle("我在想换工作的事");
    expect(bundle.related.some((m) => m.id === jobClaimId)).toBe(true);
    expect(bundle.tensions.some((m) => m.id === stayClaimId)).toBe(true);
  });

  it("沉睡的旧开放回路被专项召回（新鲜高分的会走 related，不重复）", () => {
    seed();
    const qId = insertMemory({
      type: "question",
      title: "反复纠结",
      content: "稳定还是冒险的纠结一直都在",
      // 无标签、无生活域、低重要性且已沉睡 60 天：通用打分不达标，
      // 验证 openLoops 的真实职责——把不再新鲜但未解的纠结拉回来。
      importance: 0.5,
      theme: null,
    });
    const stale = new Date(Date.now() - 60 * 86400000).toISOString();
    getDb()
      .prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(stale, stale, qId);

    const bundle = buildContextBundle("工作上的事让我烦");
    expect(bundle.related.some((m) => m.id === qId)).toBe(false);
    expect(bundle.openLoops.some((m) => m.id === qId)).toBe(true);
  });

  it("零命中时兜底返回高重要性记忆，保证有落点", () => {
    seed();
    insertMemory({
      type: "insight",
      title: "深层洞察",
      content: "我怕的不是失败是没人讨论",
      importance: 0.98,
      theme: "self",
    });
    const bundle = buildContextBundle("今天天气不错");
    expect(bundle.related.length).toBeGreaterThan(0);
    expect(bundle.related[0].importance).toBeGreaterThanOrEqual(
      bundle.related[bundle.related.length - 1].importance,
    );
  });

  it("被推翻的 value 不再进宪章，新价值取代之", () => {
    seed();
    const newValueId = insertMemory({
      type: "value",
      title: "新排序",
      content: "稳定和确定性才是第一位",
      importance: 0.88,
      theme: "meaning",
    });
    const oldValue = listMemories({ type: "value" })[0];
    supersedeMemory(oldValue.id, newValueId);

    const bundle = buildContextBundle("聊聊价值观");
    const values = bundle.constitution.filter((m) => m.type === "value");
    expect(values.some((m) => m.id === newValueId)).toBe(true);
    expect(values.every((m) => m.status === "active")).toBe(true);
  });

  it("归档记忆不出现在任何切片中", () => {
    seed();
    const archivedId = insertMemory({
      type: "claim",
      title: "旧想法",
      content: "换工作",
      importance: 0.99,
      theme: "career",
    });
    setTags(archivedId, ["换工作"]);
    setMemoryStatus(archivedId, "archived");

    const bundle = buildContextBundle("换工作的事");
    expect(bundle.related.some((m) => m.id === archivedId)).toBe(false);
  });
});
