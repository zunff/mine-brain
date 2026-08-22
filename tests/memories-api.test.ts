import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/memories/route";
import { PATCH } from "@/app/api/memories/[id]/route";

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("memory API 入参校验（非法值返回 400，而不是落库后 DB CHECK 500）", () => {
  it("POST 非法 type 返回 400", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/memories", { type: "bogus", content: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("POST 非法 theme 返回 400", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/memories", { theme: "bogus", content: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("POST 缺 content 返回 400", async () => {
    const res = await POST(jsonRequest("http://localhost/api/memories", { type: "claim" }));
    expect(res.status).toBe(400);
  });

  it("PATCH 非法 status 返回 400", async () => {
    const res = await PATCH(
      jsonRequest("http://localhost/api/memories/1", { status: "bogus" }, "PATCH"),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(400);
  });
});
