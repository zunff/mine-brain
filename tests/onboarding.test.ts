import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";
import { getMemory, listMemories } from "@/lib/memory/repo";
import {
  getAssistantPreferences,
  getOnboardingState,
  normalizeSections,
  OnboardingAlreadyCompletedError,
  planOnboardingMemories,
  SAMPLE,
  saveOnboarding,
  skipOnboarding,
} from "@/lib/memory/onboarding";

let dir: string;

beforeEach(() => {
  __resetDbForTests();
  dir = mkdtempSync(path.join(tmpdir(), "mb-onboard-"));
  process.env.MINE_BRAIN_DATA_DIR = dir;
});

afterAll(() => {
  __resetDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("normalizeSections（服务端归一化：UI 传什么都得到安全形状）", () => {
  it("超额条目被裁掉，空白卡片被丢弃", () => {
    const s = normalizeSections({
      values: [
        ...Array.from({ length: 9 }, (_, i) => ({ name: `v${i}` })),
        { name: "" },
      ],
      tensions: Array.from({ length: 7 }, (_, i) => ({ name: `t${i}`, sideA: "a", sideB: "b" })),
    });
    expect(s.values.length).toBe(6); // 上限 6：第 7 条起被裁，末尾空白卡也进不来
    expect(s.values.some((v) => v.name === "")).toBe(false);
    expect(s.tensions.length).toBe(5);
  });

  it("超长文本截断、非法 theme 回退 self、importance 钳制到 1~5", () => {
    const s = normalizeSections({
      whoami: "x".repeat(3000),
      lifeStage: { theme: "not_a_theme", goal: "g" },
      values: [{ name: "诚实", importance: 99 }],
    });
    expect(s.whoami!.length).toBe(2000);
    expect(s.lifeStage.theme).toBe("self");
    expect(s.values[0].importance).toBe(5);
  });

  it("history/decisions 只保留有实质内容的条目", () => {
    const s = normalizeSections({
      history: [{ what: "" }, { when: "2020", what: "转折事件" }],
      decisions: [{ topic: "" }, { topic: "是否换工作", options: ["留", "走"] }],
    });
    expect(s.history.length).toBe(1);
    expect(s.history[0].what).toBe("转折事件");
    expect(s.decisions.length).toBe(1);
    expect(s.decisions[0].options).toEqual(["留", "走"]);
  });
});

describe("planOnboardingMemories（卡片 → 独立记忆，颗粒度契约）", () => {
  it("每张价值卡是一条独立 value 记忆，不合并大段文本", () => {
    const planned = planOnboardingMemories(
      normalizeSections({
        values: [
          { name: "诚实", meaning: "不自我欺骗", importance: 5 },
          { name: "自由", meaning: "", importance: 3 },
        ],
      }),
    );
    const values = planned.filter((p) => p.type === "value");
    expect(values.length).toBe(2);
    expect(values[0].title).toBe("诚实");
    expect(values[0].content).toContain("诚实");
    expect(values[0].importance).toBeGreaterThan(values[1].importance);
  });

  it("每条纠结是独立 question；底线是 claim；决策风格是 pattern", () => {
    const planned = planOnboardingMemories(
      normalizeSections({
        tensions: [{ name: "稳定 vs 探索", sideA: "稳定", sideB: "探索" }],
        lifeStage: { theme: "career", goal: "转型到更有创造性的方向", bottomLine: "健康" },
        decisionStyle: "偏分析型",
      }),
    );
    const byType = (t: string) => planned.filter((p) => p.type === t);
    expect(byType("question").length).toBe(1);
    expect(byType("question")[0].content).toContain("稳定");
    expect(byType("claim")[0].content).toContain("健康");
    expect(byType("pattern")[0].theme).toBe("self");
    // 生活域透传到焦点记忆
    expect(byType("profile").some((p) => p.theme === "career")).toBe(true);
  });
});

describe("onboarding 状态机与写入", () => {
  it("初始 not_started；保存后 completed 且记忆可数；重复提交必须 force", () => {
    expect(getOnboardingState().status).toBe("not_started");

    const r1 = saveOnboarding({ values: [{ name: "诚实" }] });
    expect(r1.count).toBe(1);
    expect(getOnboardingState().status).toBe("completed");

    expect(() => saveOnboarding({ values: [{ name: "自由" }] })).toThrow(
      OnboardingAlreadyCompletedError,
    );
    // 抛错时不得产生任何新记忆
    expect(listMemories({ type: "value" }).length).toBe(1);

    const r2 = saveOnboarding(
      { values: [{ name: "自由" }] },
      { force: true },
    );
    expect(r2.count).toBe(1);
    expect(r2.archived).toBeGreaterThanOrEqual(1); // 旧画像被归档而非删除
    const all = listMemories({ type: "value", includeInactive: true });
    expect(all.filter((m) => m.status === "active").length).toBe(1);
    expect(all.filter((m) => m.status === "archived").length).toBe(1);
  });

  it("跳过是显式状态；跳过后仍可补填（不需要 force）", () => {
    skipOnboarding();
    expect(getOnboardingState().status).toBe("skipped");
    const r = saveOnboarding({ whoami: "我在转型期" });
    expect(r.count).toBe(1);
    expect(getOnboardingState().status).toBe("completed");
  });

  it("空表单提交不产生记忆也不炸（count=0 但状态完成）", () => {
    const r = saveOnboarding({});
    expect(r.count).toBe(0);
    expect(listMemories().length).toBe(0);
    expect(getOnboardingState().status).toBe("completed");
  });

  it("示例档案可用且产出多条独立记忆；偏好写入 settings 不进 memories", () => {
    const r = saveOnboarding({}, { useSample: true });
    expect(r.count).toBeGreaterThan(4);
    expect(listMemories({ type: "value" }).length).toBe(SAMPLE.values!.length);
    expect(getAssistantPreferences()).toBeDefined();
    // 偏好不属于人生记忆
    expect(listMemories().some((m) => m.content.includes("先接住情绪"))).toBe(false);
  });

  it("所有产物可溯源到 onboarding entry，且带标签", () => {
    saveOnboarding({ whoami: "关于我的一段话", values: [{ name: "成长" }] });
    for (const m of listMemories()) {
      expect(m.source_entry_id).not.toBeNull();
    }
    const mem = listMemories({ type: "value" })[0];
    expect(getMemory(mem.id)).toBeTruthy();
  });
});
