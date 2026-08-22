"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Brain,
  Compass,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Target,
  History,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const FIELDS: Array<{
  key: string;
  label: string;
  hint: string;
  placeholder: string;
  rows: number;
  icon: React.ElementType;
}> = [
  {
    key: "whoami",
    label: "我是谁 · 基础心智画像",
    hint: "身份、性格倾向、你习惯怎么做决定。写给未来的自己看。",
    placeholder:
      "例：我是一个注重深度思考与创造力的人。做决定偏理性分析，但容易陷入细节纠结。最近开始意识到……",
    rows: 3,
    icon: Brain,
  },
  {
    key: "values",
    label: "我的核心价值观 · 一致性基准",
    hint: "3~6 条，按在意程度排序。这是以后思考伙伴对照你言行一致性的最高基准。",
    placeholder: "1. 真实与真诚——不自我欺骗\n2. 长期主义——沉淀有复利的事物\n3. 掌控感——对自己的时间和注意力负责",
    rows: 4,
    icon: Compass,
  },
  {
    key: "focus",
    label: "当前人生焦点 · 阶段主旋律",
    hint: "这个阶段最核心的目标或困惑是什么？在朝什么走？什么在消耗你？",
    placeholder: "例：当前处在职业转型的探索期，同时想把个人技术与生活边界重新梳理清晰……",
    rows: 3,
    icon: Target,
  },
  {
    key: "history",
    label: "塑造我的重大过往",
    hint: "2~3 个真正改变了你的关键事件、重要转折或挫折。",
    placeholder: "例：几年前经历了一次重大的创业/项目转折，那段时间我学会了如何面对不确定性，也养成了……",
    rows: 3,
    icon: History,
  },
  {
    key: "tensions",
    label: "反复出现的纠结与张力 (开放回路)",
    hint: "那些你反复思索的矛盾点。系统会将其作为「开放回路」长期追踪并在对话中对照。",
    placeholder:
      "1. 确定性 vs 探索欲：既想要稳定的节奏，又渴望探索未知的新方向\n2. 完美主义 vs 行动速度：构思充分才敢行动，导致容易拖延",
    rows: 4,
    icon: Scale,
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"mine" | "sample" | null>(null);
  const [error, setError] = useState("");

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit(useSample: boolean) {
    setSaving(useSample ? "sample" : "mine");
    setError("");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useSample ? { useSample: true } : { sections: values }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "保存失败");
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(null);
    }
  }

  const filledCount = Object.values(values).filter((v) => v.trim().length > 0).length;
  const hasAny = filledCount > 0;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10 pb-28">
        {/* Top Header Badge */}
        <div className="flex items-center gap-2">
          <Badge variant="accent" className="text-[11px] font-normal tracking-wide">
            初次建立基准
          </Badge>
          <span className="text-xs text-muted">构建个人专属长期心智模型</span>
        </div>

        <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          让思考伙伴先认识你
        </h1>

        <p className="mt-2 text-xs sm:text-sm leading-relaxed text-muted">
          下面每一栏都是可选的——写多少随你，诚实比完整重要。
          这些内容会作为大脑的底层基准：以后每次对话它都会主动对照这里，指出你的矛盾与盲点。
        </p>

        {/* Form Fields */}
        <div className="mt-8 space-y-5">
          {FIELDS.map((f) => {
            const Icon = f.icon;
            const isFilled = (values[f.key] ?? "").trim().length > 0;
            return (
              <div
                key={f.key}
                className={cn(
                  "rounded-xl border p-4 sm:p-5 transition-all bg-surface",
                  isFilled ? "border-accent/40 shadow-xs" : "border-border"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", isFilled ? "text-accent" : "text-muted")} />
                    <label className="text-sm font-semibold text-foreground">{f.label}</label>
                  </div>
                  {isFilled && (
                    <span className="text-[10px] text-accent flex items-center gap-1 font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      已填写
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted leading-relaxed mb-3">{f.hint}</p>
                <textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={f.rows}
                  placeholder={f.placeholder}
                  className="w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-foreground outline-none placeholder:text-muted/40 focus:border-accent transition-colors"
                />
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-danger-soft p-3 text-xs text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
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
            <span>{saving === "sample" ? "正在载入..." : "使用预置示例档案"}</span>
          </Button>

          <button
            onClick={() => router.push("/")}
            disabled={saving !== null}
            className="text-xs text-muted hover:text-foreground text-center py-2 underline-offset-4 hover:underline transition-colors"
          >
            暂不填写，直接开聊
          </button>
        </div>
      </div>
    </div>
  );
}
