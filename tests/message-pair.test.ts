import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";
import {
  addMessage,
  createSession,
  deleteMessagePair,
  listMessages,
} from "@/lib/memory/repo";
import { DELETE as deletePairRoute } from "@/app/api/sessions/[id]/messages/[messageId]/route";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mb-pair-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINE_BRAIN_DATA_DIR;
});

describe("deleteMessagePair 删除一问一答", () => {
  it("用户消息 + 紧随其后的助手回复一并删除，且不再出现在会话上下文来源里", () => {
    const s = createSession("t");
    const u1 = addMessage(s.id, "user", "问题1");
    addMessage(s.id, "assistant", "回答1");
    addMessage(s.id, "user", "问题2");
    addMessage(s.id, "assistant", "回答2");

    expect(deleteMessagePair(s.id, u1.id)).toBe(2);
    // runChat 从 listMessages 加载上文——对不复存在=不会进入后续对话
    expect(listMessages(s.id).map((m) => m.content)).toEqual(["问题2", "回答2"]);
  });

  it("末轮用户消息尚无回复时只删该条", () => {
    const s = createSession("t");
    addMessage(s.id, "user", "问题A");
    const u = addMessage(s.id, "user", "悬空问题");

    expect(deleteMessagePair(s.id, u.id)).toBe(1);
    expect(listMessages(s.id).map((m) => m.content)).toEqual(["问题A"]);
  });

  it("目标不是用户消息或跨会话时返回 0，不做删除", () => {
    const s = createSession("t");
    const u = addMessage(s.id, "user", "问题");
    const a = addMessage(s.id, "assistant", "回答");
    const other = createSession("o");
    addMessage(other.id, "user", "别人的问题");

    expect(deleteMessagePair(s.id, a.id)).toBe(0); // 助手消息为目标 → 拒绝
    expect(deleteMessagePair(other.id, u.id)).toBe(0); // 跨会话定位 → 拒绝
    expect(listMessages(s.id).length).toBe(2);
    expect(listMessages(other.id).length).toBe(1);
  });
});

describe("DELETE /api/sessions/[id]/messages/[messageId] 路由", () => {
  async function routeDelete(sessionId: number, messageId: string) {
    return deletePairRoute(new Request("http://local/api"), {
      params: Promise.resolve({ id: String(sessionId), messageId }),
    });
  }

  it("合法一问一答返回 ok+deleted=2", async () => {
    const s = createSession("r");
    const u = addMessage(s.id, "user", "问题");
    addMessage(s.id, "assistant", "回答");

    const res = await routeDelete(s.id, String(u.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: 2 });
    expect(listMessages(s.id).length).toBe(0);
  });

  it("目标不存在 / 非用户消息 / 会话不存在 → 404；非法 id → 400", async () => {
    const s = createSession("r2");
    addMessage(s.id, "user", "问题");
    const assistant = addMessage(s.id, "assistant", "回答");

    expect((await routeDelete(s.id, "99999")).status).toBe(404);
    expect((await routeDelete(s.id, String(assistant.id))).status).toBe(404);
    expect((await routeDelete(999999, String(assistant.id))).status).toBe(404);
    expect((await routeDelete(Number("abc") || 0, "x")).status).toBe(400);
  });
});