"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MEMORY_TYPE_LABELS,
  THEME_LABELS,
  type MemoryRow,
  type MemoryType,
} from "@/lib/memory/types";

const TYPE_ORDER: (MemoryType | "all")[] = [
  "all",
  "profile",
  "value",
  "claim",
  "decision",
  "question",
  "insight",
  "pattern",
];

export default function MemoriesPage() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [filter, setFilter] = useState<{ type: MemoryType | "all"; all: boolean }>({
    type: "all",
    all: false,
  });
  const [loading, setLoading] = useState(true);
  const [quickInput, setQuickInput] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.type !== "all") params.set("type", filter.type);
    if (filter.all) params.set("all", "1");
    const res = await fetch(`/api/memories?${params}`);
    const data = (await res.json()) as { memories: MemoryRow[] };
    setMemories(data.memories ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function quickAdd() {
    const content = quickInput.trim();
    if (!content || adding) return;
    setAdding(true);
    await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "claim", content }),
    });
    setQuickInput("");
    setAdding(false);
    load();
  }

  async function act(id: number, action: "archive" | "delete") {
    if (action === "delete") {
      await fetch(`/api/memories/${id}`, { method: "DELETE" });
    } else {
      await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
    }
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight">记忆</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          这里是大脑的长期记忆库。被推翻的主张不会被删除——它们带着日期留在原地，
          因为「你曾经怎么想」本身就是价值。
        </p>

        {/* 快速记一笔 */}
        <div className="mt-6 flex gap-2">
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickAdd()}
            placeholder="记一笔此刻的想法、决定或纠结……"
            className="flex-1 rounded-lg border border-borderline bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted/60 focus:border-accent/50"
          />
          <button
            onClick={quickAdd}
            disabled={!quickInput.trim() || adding}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-30"
          >
            记下
          </button>
        </div>

        {/* 筛选 */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              onClick={() => setFilter((f) => ({ ...f, type: t }))}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                filter.type === t
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2"
              }`}
            >
              {t === "all" ? "全部" : MEMORY_TYPE_LABELS[t]}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={filter.all}
              onChange={(e) => setFilter((f) => ({ ...f, all: e.target.checked }))}
              className="accent-[var(--accent)]"
            />
            含已归档/已推翻
          </label>
        </div>

        {/* 列表 */}
        {loading ? (
          <p className="mt-10 text-center text-sm text-muted">加载中…</p>
        ) : memories.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted">
            还没有记忆。去对话，或上面随手记一笔。
          </p>
        ) : (
          <div className="mt-5 space-y-2 pb-16">
            {memories.map((m) => (
              <MemoryCard key={m.id} m={m} onAct={act} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryCard({
  m,
  onAct,
}: {
  m: MemoryRow;
  onAct: (id: number, action: "archive" | "delete") => void;
}) {
  const superseded = m.status === "superseded";
  const archived = m.status === "archived";
  return (
    <div
      className={`group rounded-lg border p-3.5 transition-colors ${
        superseded || archived
          ? "border-borderline/50 bg-surface/30 opacity-60"
          : "border-borderline bg-surface hover:border-accent/25"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
              {MEMORY_TYPE_LABELS[m.type] ?? m.type}
            </span>
            {m.theme && <span>{THEME_LABELS[m.theme as keyof typeof THEME_LABELS] ?? m.theme}</span>}
            <span>· {(m.valid_from ?? m.created_at).slice(0, 10)}</span>
            {superseded && <span className="text-red-400/80">已被推翻</span>}
            {archived && <span>已归档</span>}
          </div>
          {m.title && (
            <div
              className={`mt-1.5 text-sm font-medium ${superseded ? "line-through decoration-borderline" : ""}`}
            >
              {m.title}
            </div>
          )}
          <p
            className={`mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed ${
              superseded ? "text-muted line-through decoration-borderline" : ""
            }`}
          >
            {m.content}
          </p>
        </div>
        <div className="hidden shrink-0 gap-1 group-hover:flex">
          {!archived && !superseded && (
            <button
              onClick={() => onAct(m.id, "archive")}
              className="rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground"
            >
              归档
            </button>
          )}
          <button
            onClick={() => onAct(m.id, "delete")}
            className="rounded px-2 py-1 text-[11px] text-muted hover:bg-red-500/10 hover:text-red-400"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
