import { getDb, nowIso } from "@/lib/db/client";
import {
  addEntry,
  getSetting,
  insertMemory,
  setSetting,
  setTags,
} from "./repo";
import { THEMES, type MemoryType } from "./types";

/**
 * 初始画像（onboarding）：首次使用时用少量结构化输入建立长期对照基准。
 *
 * 设计原则（见 .claude/rules/project.md）：
 * - 全部可选、可跳过；跳过是显式状态，不会反复打扰。
 * - 每张卡片 = 一条独立记忆（价值观/纠结不合并成大段文本），便于单独引用与推翻。
 * - 用户亲手填写的内容即最终确认稿，直接落 active 记忆；原文保留在 entries(kind='onboarding') 可溯源。
 * - 重新建立（force）永不删除历史：旧画像记忆归档（status='archived' + valid_to），新行另起。
 */

export type OnboardingStatus = "not_started" | "completed" | "skipped";

export interface OnboardingState {
  status: OnboardingStatus;
  version: number;
  completedAt?: string;
  skippedAt?: string;
  memoryCount?: number;
}

const STATE_KEY = "onboarding";
const PREFS_KEY = "assistant_preferences";

export interface AssistantPreferences {
  /** 情绪激烈时：先接住情绪再分析，还是直接进入分析 */
  emotionMode?: "hold_first" | "analyze_first";
  /** 指出前后矛盾的方式：温和提示 / 直接点破 / 先询问是否想听 */
  contradictionStyle?: "gentle" | "direct" | "ask_first";
}

export const DEFAULT_PREFERENCES: Required<Pick<AssistantPreferences, "emotionMode" | "contradictionStyle">> = {
  emotionMode: "hold_first",
  contradictionStyle: "direct",
};

export function getAssistantPreferences(): AssistantPreferences {
  const stored = getSetting<AssistantPreferences>(PREFS_KEY);
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

/* ---------------- 输入结构 ---------------- */

export interface ValueCard {
  name: string;
  meaning?: string;
  /** 重要程度 1~5，映射到记忆 importance 0.55~0.95 */
  importance?: number;
}

export interface TensionCard {
  name: string;
  sideA: string;
  sideB: string;
  trigger?: string;
  leaning?: string;
}

export interface HistoryCard {
  when?: string;
  what: string;
  impact?: string;
  lesson?: string;
}

export interface DecisionCard {
  topic: string;
  options?: string[];
  criteria?: string[];
  worry?: string;
}

export interface LifeStageSection {
  /** 生活域，取值限定 THEMES，非法值回退 self */
  theme?: string;
  goal?: string;
  drain?: string;
  wish?: string;
  bottomLine?: string;
}

export interface OnboardingSections {
  whoami?: string;
  decisionStyle?: string;
  oneThing?: string;
  lifeStage?: LifeStageSection;
  values: ValueCard[];
  tensions: TensionCard[];
  history?: HistoryCard[];
  decisions?: DecisionCard[];
  preferences?: AssistantPreferences;
}

/* ---------------- 上限（服务端强制） ---------------- */

export const ONBOARDING_LIMITS = {
  values: 6,
  tensions: 5,
  history: 3,
  decisions: 3,
  longText: 2000,
  cardField: 500,
  name: 60,
  listItems: 3,
} as const;

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/** normalizeSections 的返回形状：所有字段必填且已归一化（与 OnboardingSections 的可选输入解耦）。 */
export interface NormalizedSections extends OnboardingSections {
  whoami: string;
  decisionStyle: string;
  oneThing: string;
  lifeStage: { theme: string; goal: string; drain: string; wish: string; bottomLine: string };
  values: ValueCard[];
  tensions: TensionCard[];
  history: HistoryCard[];
  decisions: DecisionCard[];
  preferences: AssistantPreferences;
}

/** 服务端归一化：截断超长、裁掉超额条目、丢弃空白卡片。UI 传什么都拿得到安全形状。 */
export function normalizeSections(raw: Partial<OnboardingSections>): NormalizedSections {
  const L = ONBOARDING_LIMITS;
  const values = (Array.isArray(raw.values) ? raw.values : [])
    .slice(0, L.values)
    .map((v) => ({
      name: clip(v?.name, L.name),
      meaning: clip(v?.meaning, L.cardField),
      importance: Math.min(5, Math.max(1, Number(v?.importance) || 3)),
    }))
    .filter((v) => v.name.length > 0);

  const tensions = (Array.isArray(raw.tensions) ? raw.tensions : [])
    .slice(0, L.tensions)
    .map((t) => ({
      name: clip(t?.name, L.name),
      sideA: clip(t?.sideA, L.cardField),
      sideB: clip(t?.sideB, L.cardField),
      trigger: clip(t?.trigger, L.cardField),
      leaning: clip(t?.leaning, L.cardField),
    }))
    .filter((t) => t.name.length > 0 || t.sideA.length > 0 || t.sideB.length > 0);

  const history = (Array.isArray(raw.history) ? raw.history : [])
    .slice(0, L.history)
    .map((h) => ({
      when: clip(h?.when, 40),
      what: clip(h?.what, L.cardField),
      impact: clip(h?.impact, L.cardField),
      lesson: clip(h?.lesson, L.cardField),
    }))
    .filter((h) => h.what.length > 0);

  const decisions = (Array.isArray(raw.decisions) ? raw.decisions : [])
    .slice(0, L.decisions)
    .map((d) => ({
      topic: clip(d?.topic, L.name),
      options: (Array.isArray(d?.options) ? d.options : [])
        .slice(0, L.listItems)
        .map((o) => clip(o, 120))
        .filter(Boolean),
      criteria: (Array.isArray(d?.criteria) ? d.criteria : [])
        .slice(0, L.listItems)
        .map((o) => clip(o, 60))
        .filter(Boolean),
      worry: clip(d?.worry, L.cardField),
    }))
    .filter((d) => d.topic.length > 0);

  const ls = raw.lifeStage ?? {};
  const theme = THEMES.includes(ls.theme as (typeof THEMES)[number]) ? ls.theme! : "self";
  const prefs = raw.preferences ?? {};

  return {
    whoami: clip(raw.whoami, L.longText),
    decisionStyle: clip(raw.decisionStyle, L.longText),
    oneThing: clip(raw.oneThing, L.cardField),
    lifeStage: {
      theme,
      goal: clip(ls.goal, L.longText),
      drain: clip(ls.drain, L.longText),
      wish: clip(ls.wish, L.longText),
      bottomLine: clip(ls.bottomLine, L.cardField),
    },
    values,
    tensions,
    history,
    decisions,
    preferences: {
      emotionMode:
        prefs.emotionMode === "analyze_first" || prefs.emotionMode === "hold_first"
          ? prefs.emotionMode
          : undefined,
      contradictionStyle:
        prefs.contradictionStyle === "gentle" ||
        prefs.contradictionStyle === "direct" ||
        prefs.contradictionStyle === "ask_first"
          ? prefs.contradictionStyle
          : undefined,
    },
  };
}

/* ---------------- 卡片 → 记忆规划（纯函数，可测） ---------------- */

export interface PlannedMemory {
  type: MemoryType;
  title: string;
  content: string;
  importance: number;
  theme: string | null;
  tags: string[];
}

export function planOnboardingMemories(s: OnboardingSections): PlannedMemory[] {
  const out: PlannedMemory[] = [];

  if (s.whoami) {
    out.push({
      type: "profile",
      title: "我是谁",
      content: s.whoami,
      importance: 0.95,
      theme: "self",
      tags: ["自我介绍", "初始画像"],
    });
  }
  if (s.decisionStyle) {
    out.push({
      type: "pattern",
      title: "我做决定的方式",
      content: s.decisionStyle,
      importance: 0.7,
      theme: "self",
      tags: ["决策风格", "行为模式"],
    });
  }
  if (s.oneThing) {
    out.push({
      type: "profile",
      title: "最希望伙伴了解的一件事",
      content: s.oneThing,
      importance: 0.85,
      theme: "self",
      tags: ["自我介绍"],
    });
  }

  const ls = s.lifeStage ?? {};
  const focusParts = [ls.goal && `正在靠近：${ls.goal}`, ls.drain && `消耗我的：${ls.drain}`, ls.wish && `希望的变化：${ls.wish}`]
    .filter(Boolean)
    .join("；");
  if (focusParts) {
    out.push({
      type: "profile",
      title: "当前人生焦点",
      content: focusParts,
      importance: 0.85,
      theme: ls.theme ?? "self",
      tags: ["人生阶段", "焦点"],
    });
  }
  if (ls.bottomLine) {
    out.push({
      type: "claim",
      title: "底线",
      content: `我不愿意为了其他东西牺牲：${ls.bottomLine}`,
      importance: 0.9,
      theme: ls.theme ?? "self",
      tags: ["底线", "约束"],
    });
  }

  for (const v of s.values) {
    const meaning = v.meaning ? `——${v.meaning}` : "";
    out.push({
      type: "value",
      title: v.name,
      content: `我重视「${v.name}」${meaning}`,
      importance: 0.55 + ((Math.min(5, Math.max(1, v.importance || 3)) - 1) * 0.1),
      theme: "meaning",
      tags: ["价值观", v.name],
    });
  }

  for (const t of s.tensions) {
    const parts = [
      `${t.sideA || "?"} vs ${t.sideB || "?"}`,
      t.trigger ? `通常出现在：${t.trigger}` : "",
      t.leaning ? `目前更倾向：${t.leaning}` : "",
    ].filter(Boolean);
    out.push({
      type: "question",
      title: t.name || `${t.sideA.slice(0, 12)} vs ${t.sideB.slice(0, 12)}`,
      content: parts.join("。"),
      importance: 0.75,
      theme: "self",
      tags: ["纠结", "开放回路"],
    });
  }

  for (const h of s.history ?? []) {
    const parts = [
      h.when ? `时间：${h.when}` : "",
      `发生了什么：${h.what}`,
      h.impact ? `对我的影响：${h.impact}` : "",
      h.lesson ? `留下的认知：${h.lesson}` : "",
    ].filter(Boolean);
    out.push({
      type: "claim",
      title: "塑造我的经历",
      content: parts.join("；"),
      importance: 0.8,
      theme: "self",
      tags: ["过往", "转折"],
    });
  }

  for (const d of s.decisions ?? []) {
    const options = d.options ?? [];
    const criteria = d.criteria ?? [];
    const parts = [
      `正在考虑：${d.topic}`,
      options.length > 0 ? `选项：${options.join(" / ")}` : "",
      criteria.length > 0 ? `在意标准：${criteria.join("、")}` : "",
      d.worry ? `最大担心：${d.worry}` : "",
    ].filter(Boolean);
    out.push({
      type: "decision",
      title: d.topic,
      content: parts.join("；"),
      importance: 0.8,
      theme: "career",
      tags: ["决定", "待定"],
    });
  }

  return out;
}

/* ---------------- 状态机与写入 ---------------- */

export class OnboardingAlreadyCompletedError extends Error {
  constructor() {
    super("初始画像已完成。如需重建请使用 force（旧画像会归档保留）。");
    this.name = "OnboardingAlreadyCompletedError";
  }
}

export function getOnboardingState(): OnboardingState {
  const stored = getSetting<Partial<OnboardingState>>(STATE_KEY);
  if (!stored || (stored.status !== "completed" && stored.status !== "skipped")) {
    return { status: "not_started", version: 1 };
  }
  return { version: 1, ...stored, status: stored.status } as OnboardingState;
}

export function skipOnboarding(): void {
  setSetting(STATE_KEY, {
    status: "skipped",
    version: 1,
    skippedAt: new Date().toISOString(),
  } satisfies OnboardingState);
}

/** 旧画像记忆归档（不删）：source entry 是 onboarding 的 active 记忆全部封口。 */
function archivePreviousOnboardingMemories(): number {
  const res = getDb()
    .prepare(
      `UPDATE memories SET status = 'archived', valid_to = ?, updated_at = ?
       WHERE status = 'active' AND source_entry_id IN
         (SELECT id FROM entries WHERE kind = 'onboarding')`,
    )
    .run(nowIso(), nowIso());
  return Number(res.changes);
}

/**
 * 写入初始画像。已完成后再次提交必须 force=true（旧 active 画像记忆归档，绝不删除）。
 * 返回写入的记忆条数。
 */
export function saveOnboarding(
  rawSections: Partial<OnboardingSections>,
  opts: { force?: boolean; useSample?: boolean } = {},
): { count: number; archived: number } {
  const state = getOnboardingState();
  if (state.status === "completed" && !opts.force) {
    throw new OnboardingAlreadyCompletedError();
  }

  const sections = opts.useSample ? normalizeSections(SAMPLE) : normalizeSections(rawSections);
  const planned = planOnboardingMemories(sections);

  // 重建时先归档旧画像（封口旧 active memories），再写新集合——顺序不能反，
  // 否则新的 onboarding entry 也会被归档查询误伤。
  const archived = state.status === "completed" ? archivePreviousOnboardingMemories() : 0;

  // 原文整体存为不可变 entry：所有产物可溯源
  const rawForEntry =
    opts.useSample
      ? JSON.stringify({ sample: true })
      : JSON.stringify(rawSections ?? {});
  const entryId = addEntry("onboarding", rawForEntry.slice(0, 8000));

  let count = 0;
  for (const p of planned) {
    const id = insertMemory({
      type: p.type,
      title: p.title,
      content: p.content,
      importance: p.importance,
      theme: p.theme,
      sourceEntryId: entryId,
    });
    setTags(id, p.tags);
    count++;
  }

  if (sections.preferences) {
    setSetting(PREFS_KEY, { ...getAssistantPreferences(), ...sections.preferences });
  }

  setSetting(STATE_KEY, {
    status: "completed",
    version: 1,
    completedAt: new Date().toISOString(),
    memoryCount: count,
  } satisfies OnboardingState);

  return { count, archived };
}

/* ---------------- 预置示例档案 ---------------- */

export const SAMPLE: OnboardingSections = {
  whoami:
    "我是一个正在寻找工作与生活更好平衡的人。做事偏理性，习惯先把问题想清楚再行动，但也因此容易想太多、行动慢。（这是一份示例档案，帮你先跑起来，之后可在记忆页按自己的情况调整。）",
  decisionStyle:
    "偏分析型：列利弊、查资料、想很多才动。缺点是容易在细节里打转，大事上反而拖延。",
  oneThing: "我最近在练习「诚实面对自己在意的到底是什么」，而不是追求每个决定都正确。",
  lifeStage: {
    theme: "career",
    goal: "职业转型探索期：想做更有创造性的事，同时把生活节奏调回来（睡够、恢复运动）。",
    drain: "无效加班和反复的自我怀疑。",
    wish: "三到十二个月内找到稳定与创造力的平衡点。",
    bottomLine: "健康和睡眠。",
  },
  values: [
    { name: "诚实", meaning: "对自己诚实优先于对别人交代，不自我欺骗", importance: 5 },
    { name: "成长", meaning: "每年都要感觉自己在变强，哪怕慢", importance: 4 },
    { name: "深度关系", meaning: "少数深度关系胜过一堆泛泛之交", importance: 4 },
    { name: "自由", meaning: "时间和注意力要握在自己手里", importance: 3 },
  ],
  tensions: [
    {
      name: "稳定 vs 冒险",
      sideA: "确定的收入和可控的生活",
      sideB: "做自己的事带来的创造力与自主性",
      trigger: "每次认真考虑换工作时就会反复横跳，然后拖延",
      leaning: "理智上偏稳定，情感上偏探索",
    },
    {
      name: "高标准 vs 内耗",
      sideA: "对自己要求高，把事情做好",
      sideB: "达不到就自我批评，越批评越不想动",
      trigger: "项目卡住或被指出问题时",
      leaning: "经常滑向自我批评那一侧",
    },
  ],
};
