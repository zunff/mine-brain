import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";
import { parseJsonLoose, selectFreshBatch } from "@/lib/memory/consolidate";
import {
  addEntry,
  approveCandidate,
  createSession,
  getCandidate,
  getMemory,
  insertCandidate,
  insertMemory,
  linksFor,
  listCandidates,
  rejectCandidate,
} from "@/lib/memory/repo";
import { canSupersede, type ExtractItem, type MessageRow } from "@/lib/memory/types";

function msg(id: number, role: "user" | "assistant", content: string): MessageRow {
  return { id, session_id: 1, role, content, reasoning: null, images: null, created_at: "" };
}

describe("parseJsonLoose（整理器容错 JSON 解析）", () => {
  it("解析裸 JSON", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥离 markdown 代码围栏", () => {
    const text = '```json\n{"items":[],"session_summary":"无"}\n```';
    expect(parseJsonLoose(text)).toEqual({ items: [], session_summary: "无" });
  });

  it("容忍 JSON 前后的说明文字", () => {
    const text = '好的，以下是整理结果：{"a":1} 请查收。';
    expect(parseJsonLoose(text)).toEqual({ a: 1 });
  });

  it("字符串内的右大括号不破坏截取", () => {
    expect(parseJsonLoose('{"s":"}"}')).toEqual({ s: "}" });
  });

  it("完全不是 JSON 时返回 null 而非抛错", () => {
    expect(parseJsonLoose("模型今天不想输出格式")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
    expect(parseJsonLoose("{截断的")).toBeNull();
  });
});

describe("canSupersede 语义守卫（真实 bug 回归：观察类记忆不得取代立场类）", () => {
  it("立场类可以取代旧记忆", () => {
    for (const t of ["profile", "value", "claim", "decision"] as const) {
      expect(canSupersede(t)).toBe(true);
    }
  });

  it("观察类只能质疑不能取代", () => {
    for (const t of ["question", "insight", "pattern"] as const) {
      expect(canSupersede(t)).toBe(false);
    }
  });
});

describe("selectFreshBatch 分批整理（超长会话不得静默丢段）", () => {
  it("按最新优先取连续批次，剩余留待下次", () => {
    const msgs: MessageRow[] = [];
    for (let i = 1; i <= 300; i++) {
      msgs.push(msg(i, i % 2 ? "user" : "assistant", "a".repeat(100)));
    }
    const batch = selectFreshBatch(msgs);
    // 连续、以最新一条结尾：id 从 batch[0] 到 300 无缺口
    expect(batch[batch.length - 1].id).toBe(300);
    expect(batch[0].id + batch.length - 1).toBe(300);
    // 受字符预算约束（100+6 字符/条，预算 11000 → 约 100 条上下）
    expect(batch.length).toBeGreaterThan(80);
    expect(batch.length).toBeLessThan(130);
    // 批次之上无遗漏；更旧的留到下次
    const ids = new Set(batch.map((m) => m.id));
    const minBatchId = batch[0].id;
    expect(msgs.filter((m) => m.id >= minBatchId).every((m) => ids.has(m.id))).toBe(true);
    expect(msgs.filter((m) => m.id < minBatchId).length).toBeGreaterThan(0);
  });

  it("单条超长消息作为最新时整条纳入（宁大勿丢）", () => {
    const msgs = [msg(1, "user", "x"), msg(2, "assistant", "y".repeat(20000))];
    expect(selectFreshBatch(msgs).map((m) => m.id)).toEqual([1, 2]);
  });

  it("空输入返回空批次", () => {
    expect(selectFreshBatch([])).toEqual([]);
  });
});

describe("候选暂存与确认（staging）：确认前不碰正式记忆，确认后才落库并应用语义守卫", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mb-persist-"));
    process.env.MINE_BRAIN_DATA_DIR = dir;
  });

  afterAll(() => {
    __resetDbForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    __resetDbForTests();
    const fresh = mkdtempSync(path.join(tmpdir(), "mb-persistcase-"));
    process.env.MINE_BRAIN_DATA_DIR = fresh;
    dir = fresh;
  });

  function seedValue(content = "成长第一") {
    return insertMemory({ type: "value", content, importance: 0.9, theme: "meaning" });
  }

  /** 真实的 session + entry（source_entry_id/session_id 有外键约束，不能造 0/假 id）。 */
  function freshSessionEntry() {
    const sessionId = createSession().id;
    const entryId = addEntry("chat", "对话", sessionId);
    return { sessionId, entryId };
  }

  it("插入候选不产生正式记忆（暂存与 memories 完全隔离）", () => {
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "claim", content: "我在纠结要不要换工作" },
      entryId,
      sessionId,
    );
    expect(getCandidate(cid)?.status).toBe("pending");
    expect(listCandidates({ sessionId, status: "pending" }).length).toBe(1);
    // 候选 id 不能当记忆 id 用——正式表里不存在
    expect(getMemory(cid)).toBeNull();
  });

  it("确认 claim 候选 → 落正式记忆，旧 value 不被推翻（真实 bug 回归锚点）", () => {
    const oldValue = seedValue("成长第一");
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "claim", content: "我在纠结要不要换工作" },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    expect(getMemory(memoryId)?.type).toBe("claim");
    expect(getMemory(oldValue)?.status).toBe("active");
    expect(getCandidate(cid)?.status).toBe("approved");
  });

  it("确认 value 候选不再自动封口其余 value（价值观按条独立，并存≠取代）", () => {
    const oldValue = seedValue("成长第一");
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "value", content: "现在稳定比成长重要", importance: 0.88 },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    // 新旧两条价值并存且都 active：取代关系必须显式声明，不能因为「排序变化」连坐
    expect(getMemory(oldValue)?.status).toBe("active");
    expect(getMemory(memoryId)?.status).toBe("active");
  });

  it("显式 supersedes 的 value 候选只封口指定的那一条，其余价值不受影响", () => {
    const replaced = seedValue("成长第一");
    const kept = seedValue("自由第二");
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "value", content: "我重视稳定胜过成长", importance: 0.9, supersedes: replaced },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    expect(getMemory(replaced)?.status).toBe("superseded");
    expect(getMemory(kept)?.status).toBe("active");
    const edges = linksFor([memoryId]).get(memoryId) ?? [];
    expect(edges.some((e) => e.rel === "supersedes" && e.to_id === replaced)).toBe(true);
  });

  it("显式 supersedes：确认 claim 候选可推翻 claim", () => {
    const oldClaim = insertMemory({ type: "claim", content: "我不换工作", importance: 0.7 });
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "claim", content: "我要换工作", supersedes: oldClaim },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    expect(getMemory(oldClaim)?.status).toBe("superseded");
    const edges = linksFor([memoryId]).get(memoryId) ?? [];
    expect(edges.some((e) => e.rel === "supersedes" && e.to_id === oldClaim)).toBe(true);
  });

  it("观察类候选 supersedes 降级为 related_to，目标保持 active", () => {
    const oldClaim = insertMemory({ type: "claim", content: "我不换工作", importance: 0.7 });
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "insight", content: "我的恐惧是失败", supersedes: oldClaim },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    expect(getMemory(oldClaim)?.status).toBe("active");
    const edges = linksFor([memoryId]).get(memoryId) ?? [];
    expect(edges.some((e) => e.rel === "related_to" && e.to_id === oldClaim)).toBe(true);
  });

  it("contradicts 在确认后建边", () => {
    const a = insertMemory({ type: "claim", content: "A 观点", importance: 0.6 });
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      { type: "claim", content: "B 观点", contradicts: [a] },
      entryId,
      sessionId,
    );
    const memoryId = approveCandidate(cid);
    const edges = linksFor([memoryId]).get(memoryId) ?? [];
    expect(edges.some((e) => e.rel === "contradicts" && e.to_id === a)).toBe(true);
  });

  it("拒绝候选 → 不落记忆，状态 rejected 且不再出现在待确认列表", () => {
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate({ type: "claim", content: "不想记住的" }, entryId, sessionId);
    rejectCandidate(cid);
    expect(getCandidate(cid)?.status).toBe("rejected");
    expect(listCandidates({ sessionId, status: "pending" }).length).toBe(0);
  });

  it("确认后可溯源到 entry（source_entry_id / session_id）", () => {
    const sessionId = createSession().id;
    const entryId = addEntry("chat", "对话内容", sessionId);
    const cid = insertCandidate({ type: "claim", content: "可溯源的主张" }, entryId, sessionId);
    const memoryId = approveCandidate(cid);
    expect(getMemory(memoryId)?.source_entry_id).toBe(entryId);
    expect(getMemory(memoryId)?.session_id).toBe(sessionId);
  });

  it("重复确认已决定的候选会抛错（防重复入库）", () => {
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate({ type: "claim", content: "只确认一次" }, entryId, sessionId);
    approveCandidate(cid);
    expect(() => approveCandidate(cid)).toThrow();
  });

  it("非法 type/theme 回退到 claim/null 而不报错（LLM 输出可能违反类型）", () => {
    const { sessionId, entryId } = freshSessionEntry();
    const cid = insertCandidate(
      {
        type: "not_a_type",
        theme: "not_a_theme",
        content: "乱写的字段",
        importance: "高",
      } as unknown as ExtractItem,
      entryId,
      sessionId,
    );
    const c = getCandidate(cid)!;
    expect(c.type).toBe("claim");
    expect(c.theme).toBeNull();
    expect(c.importance).toBe(0.5);
  });
});
