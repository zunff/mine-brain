import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests, getDb } from "@/lib/db/client";
import {
  addEntry,
  addMessage,
  approveCandidate,
  createSession,
  insertCandidate,
  insertMemory,
  linkMemories,
  listCandidates,
  listMemories,
  listMessages,
  listReferencedMemoryIds,
  setMemoryStatus,
  setTags,
  softDeleteMemory,
  supersedeMemory,
  truncateMessagesFrom,
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

describe("buildContextBundle — 深度思考模式", () => {
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString();

  // 生活域为 career 的立场声明，供时间线/张力夹具复用
  function careerClaim(opts: {
    validFrom?: string;
    importance?: number;
    theme?: string | null;
  } = {}) {
    return insertMemory({
      type: "claim",
      title: "换工作立场",
      content: "关于换工作的立场陈述",
      importance: opts.importance ?? 0.8,
      theme: opts.theme ?? "career",
      ...(opts.validFrom ? { validFrom: opts.validFrom } : {}),
    });
  }

  // 把记忆整体回拨到指定天数前（created_at 与 updated_at 同步，保持排序一致）
  function backdate(id: number, days: number) {
    const stale = daysAgo(days);
    getDb()
      .prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?")
      .run(stale, stale, id);
  }

  it("普通模式不构造时间线，只有深度思考才构造", () => {
    const normal = buildContextBundle("我在想换工作的事");
    expect(normal.timeline).toBeUndefined();

    const deep = buildContextBundle("我在想换工作的事", {
      deepThinking: true,
    });
    expect(deep.timeline).toBeDefined();
  });

  it("深度时间线保留已推翻的历史立场，最新立场压在最后", () => {
    const old = careerClaim({ validFrom: daysAgo(120) });
    const mid = careerClaim({ validFrom: daysAgo(60) });
    const latest = careerClaim({ validFrom: daysAgo(7) });
    supersedeMemory(old, mid);
    supersedeMemory(mid, latest);

    const bundle = buildContextBundle("我在想换工作的事", {
      deepThinking: true,
    });
    const timeline = bundle.timeline!;
    expect(timeline.map((m) => m.id)).toEqual([old, mid, latest]);
    expect(timeline.map((m) => m.status)).toEqual([
      "superseded",
      "superseded",
      "active",
    ]);
    expect(timeline[timeline.length - 1].id).toBe(latest);
  });

  it("深度思考提高张力与开放回路上限（8 vs 5，5 vs 3）", () => {
    const hub = careerClaim({ importance: 0.92 });
    setTags(hub, ["换工作"]);
    // 8 条主题/重要性双低的对立主张：进不了 related，只会沿 contradicts 边进 tensions
    for (let i = 0; i < 8; i++) {
      const sub = careerClaim({ importance: 0, theme: null });
      linkMemories(hub, sub, "contradicts");
    }
    // 6 条沉睡 60 天且无主题的旧纠结：通用打分不达标，走开放回路专项
    for (let i = 0; i < 6; i++) {
      const qId = insertMemory({
        type: "question",
        title: "旧纠结",
        content: "多年未解的纠结",
        importance: 0,
        theme: null,
      });
      backdate(qId, 60);
    }

    const msg = "我在想换工作的事";
    const normal = buildContextBundle(msg);
    expect(normal.tensions.length).toBe(5);
    expect(normal.openLoops.length).toBe(3);

    const deep = buildContextBundle(msg, { deepThinking: true });
    expect(deep.tensions.length).toBe(8);
    expect(deep.openLoops.length).toBe(5);
  });

  it("深度时间线排除归档与软删记忆", () => {
    const alive1 = careerClaim();
    const archived = careerClaim();
    const deleted = careerClaim();
    const alive2 = careerClaim({ importance: 0.7 });
    setMemoryStatus(archived, "archived");
    softDeleteMemory(deleted);

    const bundle = buildContextBundle("我在想换工作的事", {
      deepThinking: true,
    });
    const ids = bundle.timeline!.map((m) => m.id);
    expect(ids).toContain(alive1);
    expect(ids).toContain(alive2);
    expect(ids).not.toContain(archived);
    expect(ids).not.toContain(deleted);
    expect(bundle.timeline!.length).toBe(2);
  });

  it("excludeIds 排除本会话已引用记忆，宪章不受影响", () => {
    // 已引用的立场 + 它的对立面 + 沉睡 60 天的旧纠结
    const cited = careerClaim({ importance: 0.9 });
    const foe = careerClaim({ importance: 0.1, theme: null });
    linkMemories(cited, foe, "contradicts");
    const loop = insertMemory({
      type: "question",
      title: "要不要回头",
      content: "反复纠结",
      importance: 0,
      theme: null,
    });
    backdate(loop, 60);
    const value = insertMemory({
      type: "value",
      title: "工作要意义",
      content: "工作是意义的来源",
      importance: 0.9,
      theme: "meaning",
    });
    setTags(cited, ["换工作"]);

    const msg = "我在想换工作的事";
    // 第一轮：全都在
    const first = buildContextBundle(msg, { deepThinking: true });
    expect(first.related.map((m) => m.id)).toContain(cited);
    expect(first.tensions.map((m) => m.id)).toContain(foe);
    expect(first.openLoops.map((m) => m.id)).toContain(loop);
    expect(first.timeline!.map((m) => m.id)).toContain(cited);

    // 第二轮：把「已引用」的三个排除，宪章仍在
    const second = buildContextBundle(msg, {
      deepThinking: true,
      excludeIds: [cited, foe, loop],
    });
    const allSecond = [
      ...second.related,
      ...second.tensions,
      ...second.openLoops,
      ...(second.timeline ?? []),
    ].map((m) => m.id);
    expect(allSecond).not.toContain(cited);
    expect(allSecond).not.toContain(foe);
    expect(allSecond).not.toContain(loop);
    expect(second.constitution.map((m) => m.id)).toContain(value);
  });
});

describe("编辑重发截断 truncateMessagesFrom", () => {
  it("从指定消息起截断：旧问答被移除，更早的消息保留", () => {
    const s = createSession("测试会话");
    addMessage(s.id, "user", "第一问", undefined, undefined);
    addMessage(s.id, "assistant", "第一答", undefined, undefined);
    const p2 = addMessage(s.id, "user", "第二问", undefined, undefined);
    addMessage(s.id, "assistant", "第二答", undefined, undefined);

    // 编辑第二问：从 p2 起截断，p2 与其后的回答都消失
    truncateMessagesFrom(s.id, p2.id);

    const remaining = listMessages(s.id)
      .map((m) => `${m.role}:${m.content}`)
      .sort();
    expect(remaining).toEqual(["assistant:第一答", "user:第一问"].sort());
    expect(remaining).not.toContain("user:第二问");
    expect(remaining).not.toContain("assistant:第二答");
  });

  it("截断按会话隔离，不影响其它会话", () => {
    const a = createSession("会话A");
    const b = createSession("会话B");
    addMessage(b.id, "user", "B 的问题", undefined, undefined);
    addMessage(a.id, "user", "A 的问题", undefined, undefined);
    const aPending = addMessage(a.id, "user", "A 待删", undefined, undefined);

    truncateMessagesFrom(a.id, aPending.id);

    const bTexts = listMessages(b.id).map((m) => m.content);
    expect(bTexts).toContain("B 的问题");
    const aTexts = listMessages(a.id).map((m) => m.content);
    expect(aTexts).toContain("A 的问题");
    expect(aTexts).not.toContain("A 待删");
  });

  it("截断把该会话待确认候选标为 rejected；已确认的记忆候选不动", () => {
    const s = createSession("候选会话");
    addMessage(s.id, "user", "问题", undefined, undefined);
    addMessage(s.id, "assistant", "回答", undefined, undefined);
    const entryId = addEntry("chat", "这段对话", s.id);
    const pendingId = insertCandidate(
      { type: "claim", title: "待确认", content: "要沉淀的东西", importance: 0.7 },
      entryId,
      s.id,
    );
    const decidedId = insertCandidate(
      { type: "value", title: "已确认", content: "已经入库的价值观", importance: 0.9 },
      entryId,
      s.id,
    );
    approveCandidate(decidedId);

    truncateMessagesFrom(s.id, addMessage(s.id, "user", "最后的问题", undefined, undefined).id);

    const pending = listCandidates({ sessionId: s.id, status: "pending" });
    const rejected = listCandidates({ sessionId: s.id, status: "rejected" });
    const approved = listCandidates({ sessionId: s.id, status: "approved" });
    expect(pending.map((c) => c.id)).not.toContain(pendingId);
    expect(rejected.map((c) => c.id)).toContain(pendingId);
    expect(approved.map((c) => c.id)).toContain(decidedId);
  });

  it("截断只清本会话候选，其它会话的待确认候选保持 pending", () => {
    const a = createSession("会话A");
    const b = createSession("会话B");
    addMessage(a.id, "user", "A 问题", undefined, undefined);
    addMessage(a.id, "assistant", "A 答", undefined, undefined);
    addMessage(b.id, "user", "B 问题", undefined, undefined);
    addMessage(b.id, "assistant", "B 答", undefined, undefined);
    const bEntry = addEntry("chat", "B 的对话", b.id);
    const bCandidate = insertCandidate(
      { type: "claim", title: "B 候选", content: "B 的内容", importance: 0.5 },
      bEntry,
      b.id,
    );

    truncateMessagesFrom(a.id, addMessage(a.id, "user", "A 要截断的问题", undefined, undefined).id);

    const bPending = listCandidates({ sessionId: b.id, status: "pending" });
    expect(bPending.some((c) => c.id === bCandidate)).toBe(true);
  });
});

describe("listReferencedMemoryIds — 会话级全面去重", () => {
  it("收集整个会话助手消息的引用，去重且不受最近条数限制", () => {
    const s = createSession("引用测试");
    const m1 = insertMemory({ type: "claim", title: "记忆一", content: "内容一", importance: 0.5 });
    const m2 = insertMemory({ type: "claim", title: "记忆二", content: "内容二", importance: 0.5 });
    addMessage(s.id, "user", "第一问", undefined, undefined);
    addMessage(
      s.id,
      "assistant",
      "第一答",
      undefined,
      undefined,
      undefined,
      JSON.stringify({ memories: [{ id: m1 }, { id: m2 }] }),
    );
    addMessage(
      s.id,
      "assistant",
      "第二答",
      undefined,
      undefined,
      undefined,
      JSON.stringify({ memories: [{ id: m1 }] }),
    );
    const ids = listReferencedMemoryIds(s.id);
    expect(ids).toEqual(expect.arrayContaining([m1, m2]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("忽略损坏的 retrieved_memories 与 user 消息", () => {
    const s = createSession("引用测试2");
    addMessage(s.id, "assistant", "坏 JSON", undefined, undefined, "{{{ not json");
    addMessage(s.id, "user", "用户消息", undefined, undefined);
    expect(listReferencedMemoryIds(s.id)).toEqual([]);
  });
});
