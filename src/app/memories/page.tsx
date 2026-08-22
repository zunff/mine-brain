"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEMORY_TYPE_LABELS,
  THEME_LABELS,
  type MemoryRow,
  type MemoryType,
} from "@/lib/memory/types";

type MemoryWithTags = MemoryRow & { tags?: string[] };

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
  const [memories, setMemories] = useState<MemoryWithTags[]>([]);
  const [filter, setFilter] = useState<{ type: MemoryType | "all"; all: boolean }>({
    type: "all",
    all: true,
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [quickInput, setQuickInput] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.type !== "all") params.set("type", filter.type);
    if (filter.all) params.set("all", "1");
    const res = await fetch(`/api/memories?${params}`);
    const data = (await res.json()) as { memories: MemoryWithTags[] };
    setMemories(data.memories ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索：标题 + 内容 + 标签，大小写不敏感
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [memories, query]);

  // 时间线分组：按月
  const groups = useMemo(() => {
    const map = new Map<string, MemoryWithTags[]>();
    for (const m of filtered) {
      const key = (m.valid_from ?? m.created_at).slice(0, 7);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const stats = useMemo(
    () => ({
      total: filtered.length,
      decisions: filtered.filter((m) => m.type === "decision").length,
      openLoops: filtered.filter((m) => m.type === "question" && m.status === "active").length,
      superseded: filtered.filter((m) => m.status === "superseded").length,
    }),
    [filtered],
  );

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
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">记忆</h1>
          <p className="text-xs text-muted">
            被推翻的主张不会删除——「你曾经怎么想」本身就是价值。
          </p>
        </div>

        {/* 统计概览 */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="全部记忆" value={stats.total} />
          <Stat label="决定" value={stats.decisions} />
          <Stat label="开放回路" value={stats.openLoops} accent />
          <Stat label="已被推翻" value={stats.superseded} muted />
        </div>

        {/* 快速记一笔 */}
        <div className="mt-4 flex gap-2">
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

        {/* 搜索 */}
        <div className="relative mt-3">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆：内容、标题、标签……"
            className="w-full rounded-lg border border-borderline bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent/50"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
            >
              清除
            </button>
          )}
        </div>

        {/* 筛选 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
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

        {/* 时间线 */}
        {loading ? (
          <div className="mt-10 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted">
            {query ? `没有匹配「${query}」的记忆。` : "还没有记忆。去对话，或上面随手记一笔。"}
          </p>
        ) : (
          <div className="mt-6 pb-16">
            {groups.map(([month, items]) => (
              <section key={month} className="relative mt-2 first:mt-0">
                <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 bg-background/95 px-1 py-2 backdrop-blur-sm">
                  <span className="text-xs font-medium tracking-wider text-accent">
                    {month.replace("-", " 年 ")} 月
                  </span>
                  <span className="text-[11px] text-muted">{items.length} 条</span>
                  <div className="h-px flex-1 bg-borderline" />
                </div>
                <div className="space-y-2 pt-1">
                  {items.map((m) => (
                    <MemoryCard key={m.id} m={m} onAct={act} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-borderline bg-surface px-3.5 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold ${
          accent ? "text-accent" : muted ? "text-muted" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function MemoryCard({
  m,
  onAct,
}: {
  m: MemoryWithTags;
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
            {m.theme && (
              <span>{THEME_LABELS[m.theme as keyof typeof THEME_LABELS] ?? m.theme}</span>
            )}
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
          {(m.tags?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {m.tags!.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-borderline px-2 py-0.5 text-[10px] text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
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
