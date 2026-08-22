"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS: Array<{
  key: string;
  label: string;
  hint: string;
  placeholder: string;
  rows: number;
}> = [
  {
    key: "whoami",
    label: "我是谁",
    hint: "身份、性格倾向、你习惯怎么做决定。写给未来的自己看。",
    placeholder:
      "例：我是一个……的人。做事偏……，容易……。最近开始意识到……",
    rows: 4,
  },
  {
    key: "values",
    label: "我的价值观",
    hint: "3~6 条，按在意程度排序。这是以后「一致性校验」的基准。",
    placeholder: "1. 诚实——……\n2. 成长——……\n3. ……",
    rows: 5,
  },
  {
    key: "focus",
    label: "当前人生焦点",
    hint: "这个阶段的主旋律是什么？在朝什么走？什么在耗你？",
    placeholder: "例：当前处在……的犹豫期：……同时想把……",
    rows: 4,
  },
  {
    key: "history",
    label: "塑造我的过往",
    hint: "2~3 个真正改变了你的事件或阶段。",
    placeholder: "例：过去几年最大的转折是……那段时间我学会了……也养成了……",
    rows: 4,
  },
  {
    key: "tensions",
    label: "反复出现的纠结（可多条，空行分隔）",
    hint: "那些你会一遍遍想的问题。这些会被当作「开放回路」长期追踪。",
    placeholder:
      "1. 稳定 vs 冒险：想要确定的收入，又羡慕……\n\n2. 对自己要求高 vs 容易内耗：……",
    rows: 5,
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

  const hasAny = Object.values(values).some((v) => v.trim().length > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <p className="text-xs uppercase tracking-widest text-accent">第一次见面</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          让大脑先认识你
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          下面每一栏都是可选的——写多少随你，诚实比完整重要。
          这些会成为它的长期记忆底座：以后每次对话它都会对照这里，
          指出你的变化与矛盾。全部跳过也可以直接用示例档案体验。
        </p>

        <div className="mt-8 space-y-6">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-sm font-medium">{f.label}</label>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{f.hint}</p>
              <textarea
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                rows={f.rows}
                placeholder={f.placeholder}
                className="mt-2 w-full resize-y rounded-lg border border-borderline bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted/50 focus:border-accent/50"
              />
            </div>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-8 flex flex-wrap items-center gap-3 pb-16">
          <button
            onClick={() => submit(false)}
            disabled={!hasAny || saving !== null}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-30"
          >
            {saving === "mine" ? "写入中…" : "写入记忆，开始"}
          </button>
          <button
            onClick={() => submit(true)}
            disabled={saving !== null}
            className="rounded-lg border border-borderline px-5 py-2.5 text-sm text-muted transition hover:border-accent/40 hover:text-foreground disabled:opacity-30"
          >
            {saving === "sample" ? "写入中…" : "先用示例档案体验"}
          </button>
          <button
            onClick={() => router.push("/")}
            disabled={saving !== null}
            className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            跳过，直接开聊
          </button>
        </div>
      </div>
    </div>
  );
}
