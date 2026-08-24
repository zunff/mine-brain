"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Compass,
  Target,
  Scale,
  History,
  GitCompareArrows,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Plus,
  Trash2,
  ChevronDown,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  DecisionCard,
  HistoryCard,
  OnboardingSections,
  TensionCard,
  ValueCard,
} from "@/lib/memory/onboarding";

const THEME_OPTIONS = [
  { value: "career", label: "事业" },
  { value: "relationship", label: "关系" },
  { value: "family", label: "家庭" },
  { value: "health", label: "健康" },
  { value: "money", label: "金钱" },
  { value: "growth", label: "成长" },
  { value: "meaning", label: "意义" },
  { value: "self", label: "自我" },
] as const;

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-foreground outline-none placeholder:text-muted/40 focus:border-accent transition-colors";

const DRAFT_KEY = "mb-onboarding-v2";
const MAX_VALUES = 6;
const MAX_TENSIONS = 5;
const MAX_HISTORY = 3;
const MAX_DECISIONS = 3;

type StageState = {
  theme: string;
  goal: string;
  drain: string;
  wish: string;
  bottomLine: string;
};
type PrefsState = { emotionMode: string; contradictionStyle: string };
type Draft = {
  whoami: string;
  decisionStyle: string;
  oneThing: string;
  stage: StageState;
  values: ValueCard[];
  tensions: TensionCard[];
  history: HistoryCard[];
  decisions: DecisionCard[];
  prefs: PrefsState;
};

function CardShell({
  title,
  icon: Icon,
  filled,
  children,
}: {
  title: string;
  icon: React.ElementType;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4 sm:p-5 transition-all bg-surface",
        filled ? "border-accent/40 shadow-xs" : "border-border",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", filled ? "text-accent" : "text-muted")} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {filled && (
          <span className="text-[10px] text-accent flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3 w-3" />
            已填写
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] text-muted mb-1">{children}</label>;
}

function AddButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-muted transition-colors",
        !disabled && "hover:border-accent/50 hover:text-accent",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="text-muted/60 hover:text-danger transition-colors shrink-0 mt-5"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** 可折叠区块：默认收起，第一次使用不制造信息过载。 */
function Collapsible({
  title,
  onToggle,
  open,
}: {
  title: string;
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-4 py-3 text-sm font-semibold text-foreground transition-colors"
    >
      <ChevronDown
        className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")}
      />
      <span>{title}</span>
      <span className="text-[10px] font-normal text-muted ml-auto">可选</span>
    </button>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [force, setForce] = useState(false);

  const [whoami, setWhoami] = useState("");
  const [decisionStyle, setDecisionStyle] = useState("");
  const [oneThing, setOneThing] = useState("");
  const [stage, setStage] = useState<StageState>({
    theme: "self",
    goal: "",
    drain: "",
    wish: "",
    bottomLine: "",
  });
  const [values, setValues] = useState<ValueCard[]>([
    { name: "", meaning: "", importance: 3 },
    { name: "", meaning: "", importance: 3 },
  ]);
  const [tensions, setTensions] = useState<TensionCard[]>([
    { name: "", sideA: "", sideB: "", trigger: "", leaning: "" },
  ]);
  const [history, setHistory] = useState<HistoryCard[]>([]);
  const [decisions, setDecisions] = useState<DecisionCard[]>([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [prefs, setPrefs] = useState<PrefsState>({
    emotionMode: "hold_first",
    contradictionStyle: "direct",
  });

  const [saving, setSaving] = useState<"mine" | "sample" | "skip" | null>(null);
  const [error, setError] = useState("");
  const draftRef = useRef<Draft | null>(null);

  // force 参数：从设置页「重新建立初始画像」进入；本地草稿自动恢复。
// 用 setTimeout 延迟到下一帧再 setState，避免 effect 内同步级联渲染。
useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(DRAFT_KEY);
    } catch {
      /* storage 不可用 */
    }
    const forceParam = new URLSearchParams(window.location.search).get("force") === "1";
    const timer = setTimeout(() => {
      if (forceParam) setForce(true);
      if (!raw) return;
      try {
        const draft = JSON.parse(raw) as Partial<Draft>;
        if (typeof draft.whoami === "string") setWhoami(draft.whoami);
        if (typeof draft.decisionStyle === "string") setDecisionStyle(draft.decisionStyle);
        if (typeof draft.oneThing === "string") setOneThing(draft.oneThing);
        if (draft.stage) setStage((s) => ({ ...s, ...draft.stage! }));
        if (Array.isArray(draft.values) && draft.values.length > 0) setValues(draft.values);
        if (Array.isArray(draft.tensions)) setTensions(draft.tensions);
        if (Array.isArray(draft.history)) setHistory(draft.history);
        if (Array.isArray(draft.decisions)) setDecisions(draft.decisions);
        if (draft.prefs) setPrefs((p) => ({ ...p, ...draft.prefs! }));
        if ((draft.history?.length ?? 0) > 0 || (draft.decisions?.length ?? 0) > 0) {
          setExtraOpen(true);
        }
      } catch {
        /* 损坏草稿忽略 */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    draftRef.current = {
      whoami,
      decisionStyle,
      oneThing,
      stage,
      values,
      tensions,
      history,
      decisions,
      prefs,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftRef.current));
    } catch {
      /* 私密模式下 storage 可能不可用 */
    }
  }, [whoami, decisionStyle, oneThing, stage, values, tensions, history, decisions, prefs]);

  const setValueAt = (i: number, patch: Partial<ValueCard>) =>
    setValues((v) => v.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const setTensionAt = (i: number, patch: Partial<TensionCard>) =>
    setTensions((t) => t.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const setHistoryAt = (i: number, patch: Partial<HistoryCard>) =>
    setHistory((h) => h.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const setDecisionAt = (i: number, patch: Partial<DecisionCard>) =>
    setDecisions((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const sections = (): OnboardingSections => ({
    whoami,
    decisionStyle,
    oneThing,
    lifeStage: stage,
    values,
    tensions,
    history,
    decisions,
    preferences: {
      emotionMode:
        prefs.emotionMode === "analyze_first" ? "analyze_first" : "hold_first",
      contradictionStyle:
        prefs.contradictionStyle === "gentle" || prefs.contradictionStyle === "ask_first"
          ? prefs.contradictionStyle
          : "direct",
    },
  });

  async function submit(useSample: boolean) {
    setSaving(useSample ? "sample" : "mine");
    setError("");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useSample ? { useSample: true, force } : { sections: sections(), force },
        ),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "保存失败");
      localStorage.removeItem(DRAFT_KEY);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  }

  async function skip() {
    setSaving("skip");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip" }),
      });
      if (!res.ok) throw new Error("跳过失败");
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  }

  const filledCount =
    [whoami, decisionStyle, oneThing, stage.goal, stage.drain, stage.wish, stage.bottomLine].filter(
      (s) => s.trim().length > 0,
    ).length +
    values.filter((v) => v.name.trim()).length +
    tensions.filter((t) => t.name.trim()).length +
    history.length +
    decisions.length;
  const hasAny = filledCount > 0;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10 pb-28">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="accent" className="text-[11px] font-normal tracking-wide">
            初次建立基准
          </Badge>
          {force && (
            <Badge className="text-[11px] font-normal">重建模式 · 旧画像将归档保留</Badge>
          )}
          <span className="text-xs text-muted">构建个人专属长期心智模型</span>
        </div>

        <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          让思考伙伴先认识你
        </h1>

        <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted">
          每一栏都是可选的——写多少随你，诚实比完整重要。这些内容会成为大脑的底层基准，
          以后每次对话它都会主动对照这里，指出你的矛盾与盲点。草稿自动保存在本地。
        </p>

        <div className="mt-8 space-y-5">
          {/* 1. 现在的我 */}
          <CardShell
            title="现在的我"
            icon={Brain}
            filled={Boolean(whoami || decisionStyle || oneThing)}
          >
            <p className="text-xs text-muted leading-relaxed mb-3">
              不用写完整自我介绍，只写那些会影响你思考和决定的部分。
            </p>
            <div className="space-y-3">
              <div>
                <FieldLabel>我现在处于什么人生阶段 / 正在经历什么</FieldLabel>
                <textarea
                  value={whoami}
                  onChange={(e) => setWhoami(e.target.value)}
                  rows={2}
                  placeholder="例：正在职业转型的探索期，同时想把生活节奏调回来……"
                  className={cn(inputCls, "resize-y")}
                />
              </div>
              <div>
                <FieldLabel>我通常怎么做决定</FieldLabel>
                <textarea
                  value={decisionStyle}
                  onChange={(e) => setDecisionStyle(e.target.value)}
                  rows={2}
                  placeholder="例：偏分析型，先列利弊查资料，但容易在细节里打转、大事拖延……"
                  className={cn(inputCls, "resize-y")}
                />
              </div>
              <div>
                <FieldLabel>最近最希望伙伴了解我的一件事</FieldLabel>
                <input
                  value={oneThing}
                  onChange={(e) => setOneThing(e.target.value)}
                  placeholder="一句话即可"
                  className={inputCls}
                />
              </div>
            </div>
          </CardShell>

          {/* 2. 当前人生阶段 */}
          <CardShell
            title="当前人生阶段 · 主旋律"
            icon={Target}
            filled={Boolean(stage.goal || stage.drain || stage.wish || stage.bottomLine)}
          >
            <p className="text-xs text-muted leading-relaxed mb-3">
              这个阶段最核心的方向和消耗是什么？关联到你的生活域，便于以后按主题检索。
            </p>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <FieldLabel>生活域</FieldLabel>
                <select
                  value={stage.theme}
                  onChange={(e) => setStage((s) => ({ ...s, theme: e.target.value }))}
                  className={cn(inputCls, "cursor-pointer")}
                >
                  {THEME_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>我正在靠近什么</FieldLabel>
                <textarea
                  value={stage.goal}
                  onChange={(e) => setStage((s) => ({ ...s, goal: e.target.value }))}
                  rows={2}
                  placeholder="目标或方向"
                  className={cn(inputCls, "resize-y")}
                />
              </div>
              <div>
                <FieldLabel>什么在消耗我</FieldLabel>
                <input
                  value={stage.drain}
                  onChange={(e) => setStage((s) => ({ ...s, drain: e.target.value }))}
                  placeholder="当前压力来源"
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel>未来 3~12 个月想看见什么变化</FieldLabel>
                <input
                  value={stage.wish}
                  onChange={(e) => setStage((s) => ({ ...s, wish: e.target.value }))}
                  placeholder="可选"
                  className={inputCls}
                />
              </div>
              <div>
                <FieldLabel>我不愿意为了什么牺牲什么（底线）</FieldLabel>
                <input
                  value={stage.bottomLine}
                  onChange={(e) => setStage((s) => ({ ...s, bottomLine: e.target.value }))}
                  placeholder="例：健康和睡眠"
                  className={inputCls}
                />
              </div>
            </div>
          </CardShell>

          {/* 3. 我的价值观 */}
          <CardShell
            title="我的价值观 · 一致性基准"
            icon={Compass}
            filled={values.some((v) => v.name.trim())}
          >
            <p className="text-xs text-muted leading-relaxed mb-3">
              每条价值观独立保存、单独可推翻。建议 3~5 条；写「它对你意味着什么」比只列名词更有用。
            </p>
            <div className="space-y-3">
              {values.map((v, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 items-start rounded-lg border border-border bg-surface-2/60 p-3"
                >
                  <div>
                    <FieldLabel>价值观</FieldLabel>
                    <input
                      value={v.name}
                      onChange={(e) => setValueAt(i, { name: e.target.value })}
                      maxLength={60}
                      placeholder="如：诚实 / 自由 / 成长"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <FieldLabel>对我意味着什么</FieldLabel>
                    <input
                      value={v.meaning ?? ""}
                      onChange={(e) => setValueAt(i, { meaning: e.target.value })}
                      placeholder="不自我欺骗，哪怕答案不好听……"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <FieldLabel>重要程度</FieldLabel>
                    <select
                      value={v.importance ?? 3}
                      onChange={(e) => setValueAt(i, { importance: Number(e.target.value) })}
                      className={cn(inputCls, "cursor-pointer")}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <AddButton
              label="添加一条价值观"
              onClick={() => setValues((v) => [...v, { name: "", meaning: "", importance: 3 }])}
              disabled={values.length >= MAX_VALUES}
            />
          </CardShell>

          {/* 4. 反复出现的纠结 */}
          <CardShell
            title="反复出现的纠结与张力"
            icon={Scale}
            filled={tensions.some((t) => t.name.trim())}
          >
            <p className="text-xs text-muted leading-relaxed mb-3">
              系统会把每条张力作为「开放回路」长期追踪，在对话逼近时轻轻拉回对照。
            </p>
            <div className="space-y-3">
              {tensions.map((t, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <FieldLabel>这场纠结可以怎么命名</FieldLabel>
                      <input
                        value={t.name}
                        onChange={(e) => setTensionAt(i, { name: e.target.value })}
                        maxLength={60}
                        placeholder="如：稳定 vs 探索"
                        className={inputCls}
                      />
                    </div>
                    <RemoveButton
                      onClick={() => setTensions((x) => x.filter((_, idx) => idx !== i))}
                      label="删除这条纠结"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <FieldLabel>一边是什么</FieldLabel>
                      <input
                        value={t.sideA}
                        onChange={(e) => setTensionAt(i, { sideA: e.target.value })}
                        placeholder="如：稳定的收入和可控的生活"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <FieldLabel>另一边是什么</FieldLabel>
                      <input
                        value={t.sideB}
                        onChange={(e) => setTensionAt(i, { sideB: e.target.value })}
                        placeholder="如：做自己的事的创造力与自主性"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <FieldLabel>它通常在什么情况下出现</FieldLabel>
                      <input
                        value={t.trigger ?? ""}
                        onChange={(e) => setTensionAt(i, { trigger: e.target.value })}
                        placeholder="可选"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <FieldLabel>目前更倾向哪一边</FieldLabel>
                      <input
                        value={t.leaning ?? ""}
                        onChange={(e) => setTensionAt(i, { leaning: e.target.value })}
                        placeholder="可选"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <AddButton
              label="添加一条纠结"
              onClick={() =>
                setTensions((t) => [
                  ...t,
                  { name: "", sideA: "", sideB: "", trigger: "", leaning: "" },
                ])
              }
              disabled={tensions.length >= MAX_TENSIONS}
            />
          </CardShell>

          {/* 可选区 */}
          <Collapsible
            title="塑造我的关键经历 · 正在考虑的决定"
            onToggle={() => setExtraOpen((o) => !o)}
            open={extraOpen}
          />

          {extraOpen && (
            <div className="space-y-5">
              {/* 5. 关键经历 */}
              <CardShell title="塑造我的关键经历" icon={History} filled={history.length > 0}>
                <p className="text-xs text-muted leading-relaxed mb-3">
                  真正改变过你的关键事件或转折，最多 3 件。不必写完整人生史。
                </p>
                <div className="space-y-3">
                  {history.map((h, i) => (
                    <div key={i} className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <div>
                          <FieldLabel>大概什么时候</FieldLabel>
                          <input
                            value={h.when ?? ""}
                            onChange={(e) => setHistoryAt(i, { when: e.target.value })}
                            placeholder="年份或人生阶段"
                            className={inputCls}
                          />
                        </div>
                        <RemoveButton
                          onClick={() => setHistory((x) => x.filter((_, idx) => idx !== i))}
                          label="删除这段经历"
                        />
                      </div>
                      <div>
                        <FieldLabel>发生了什么</FieldLabel>
                        <textarea
                          value={h.what}
                          onChange={(e) => setHistoryAt(i, { what: e.target.value })}
                          rows={2}
                          className={cn(inputCls, "resize-y")}
                        />
                      </div>
                      <div>
                        <FieldLabel>它怎样影响了我 / 我形成了什么看法</FieldLabel>
                        <input
                          value={h.impact ?? ""}
                          onChange={(e) => setHistoryAt(i, { impact: e.target.value })}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <AddButton
                  label="添加一段经历"
                  onClick={() =>
                    setHistory((h) => [...h, { when: "", what: "", impact: "", lesson: "" }])
                  }
                  disabled={history.length >= MAX_HISTORY}
                />
              </CardShell>

              {/* 6. 正在考虑的决定 */}
              <CardShell
                title="当前正在考虑的决定"
                icon={GitCompareArrows}
                filled={decisions.length > 0}
              >
                <p className="text-xs text-muted leading-relaxed mb-3">
                  如果你正在权衡某个具体选择，写下来，之后可以拿它当第一次深聊的起点。
                </p>
                <div className="space-y-3">
                  {decisions.map((d, i) => (
                    <div key={i} className="rounded-lg border border-border bg-surface-2/60 p-3 space-y-2">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <div>
                          <FieldLabel>我在考虑什么</FieldLabel>
                          <input
                            value={d.topic}
                            onChange={(e) => setDecisionAt(i, { topic: e.target.value })}
                            maxLength={60}
                            placeholder="如：是否换工作 / 搬家 / 开始新项目"
                            className={inputCls}
                          />
                        </div>
                        <RemoveButton
                          onClick={() => setDecisions((x) => x.filter((_, idx) => idx !== i))}
                          label="删除这个决定"
                        />
                      </div>
                      <div>
                        <FieldLabel>当前选项（用 / 分隔）</FieldLabel>
                        <input
                          value={d.options?.join(" / ") ?? ""}
                          onChange={(e) =>
                            setDecisionAt(i, {
                              options: e.target.value
                                .split("/")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="留下 / 离职创业 / 内部转岗"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <FieldLabel>我在意的判断标准</FieldLabel>
                        <input
                          value={d.criteria?.join("、") ?? ""}
                          onChange={(e) =>
                            setDecisionAt(i, {
                              criteria: e.target.value
                                .split(/[,、]/)
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="收入、自由、成长、关系"
                          className={inputCls}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <AddButton
                  label="添加一个待定决定"
                  onClick={() =>
                    setDecisions((d) => [...d, { topic: "", options: [], criteria: [], worry: "" }])
                  }
                  disabled={decisions.length >= MAX_DECISIONS}
                />
              </CardShell>
            </div>
          )}

          {/* 7. 互动偏好 */}
          <CardShell
            title="思考伙伴怎么配合你 · 互动偏好"
            icon={Sparkles}
            filled={prefs.emotionMode !== "hold_first" || prefs.contradictionStyle !== "direct"}
          >
            <p className="text-xs text-muted leading-relaxed mb-3">
              这不是人生记忆，而是「希望你怎样工作」——每次对话都会生效。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel>情绪上来的时候</FieldLabel>
                <select
                  value={prefs.emotionMode}
                  onChange={(e) => setPrefs((p) => ({ ...p, emotionMode: e.target.value }))}
                  className={cn(inputCls, "cursor-pointer")}
                >
                  <option value="hold_first">先接住情绪，平缓后再分析</option>
                  <option value="analyze_first">直接进入分析，不用安抚</option>
                </select>
              </div>
              <div>
                <FieldLabel>发现我前后矛盾时</FieldLabel>
                <select
                  value={prefs.contradictionStyle}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, contradictionStyle: e.target.value }))
                  }
                  className={cn(inputCls, "cursor-pointer")}
                >
                  <option value="direct">直接点破，不绕弯子</option>
                  <option value="gentle">温和带出，用提问引导</option>
                  <option value="ask_first">先问我是否想听，再展开</option>
                </select>
              </div>
            </div>
          </CardShell>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-danger-soft p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 rounded-lg border border-border/60 bg-surface-2/40 p-2.5 text-[11px] text-muted">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>写出后：原文存为不可变记录，结构化为独立记忆，日后单条可直接在记忆页修正。</span>
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => submit(false)}
            disabled={!hasAny || saving !== null}
            className="h-10 px-6 gap-2 font-medium"
          >
            <span>{saving === "mine" ? "正在写入心智库..." : "写入记忆，开启对话"}</span>
            <ArrowRight className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => submit(true)}
            disabled={saving !== null}
            className="h-10 px-5 gap-1.5"
          >
            <BookOpen className="h-4 w-4 text-accent" />
            <span>{saving === "sample" ? "正在载入..." : "使用示例档案"}</span>
          </Button>

          <button
            onClick={skip}
            disabled={saving !== null}
            className="text-xs text-muted hover:text-foreground text-center py-2 underline-offset-4 hover:underline transition-colors"
          >
            {saving === "skip" ? "正在跳过..." : "暂不填写，直接开聊"}
          </button>
        </div>
      </div>
    </div>
  );
}