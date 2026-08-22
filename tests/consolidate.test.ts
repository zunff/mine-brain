import { describe, expect, it } from "vitest";
import { canSupersede, parseJsonLoose } from "@/lib/memory/consolidate";

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
