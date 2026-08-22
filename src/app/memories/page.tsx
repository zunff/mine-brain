"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Archive,
  Calendar,
  Tag,
  Check,
  AlertCircle,
  X,
  Compass,
  FileQuestion,
  Lightbulb,
  Sparkles,
  Layers,
  History,
  ShieldAlert,
} from "lucide-react";
import {
  MEMORY_TYPE_LABELS,
  THEME_LABELS,
  type MemoryRow,
  type MemoryType,
} from "@/lib/memory/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MemoryWithTags = MemoryRow & { tags?: string[] };

const TYPE_ORDER: { type: MemoryType | "all"; label: string; icon: React.ElementType }[] = [
  { type: "all", label: "全部", icon: Layers },
  { type: "profile", label: "个人画像", icon: Brain },
  { type: "value", label: "核心价值", icon: Compass },
  { type: "claim", label: "主张信念", icon: Sparkles },
  { type: "decision", label: "重大决定", icon: Check },
  { type: "question", label: "开放回路", icon: FileQuestion },
  { type: "insight", label: "核心洞察", icon: Lightbulb },
  { type: "pattern", label: "思维模式", icon: History },
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

  // New Memory Modal state
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newType, setNewType] = useState<MemoryType>("claim");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTheme, setNewTheme] = useState<string>("");
  const [newTags, setNewTags] = useState("");

  // Delete / Archive dialog state
  const [actionTarget, setActionTarget] = useState<{
    id: number;
    title: string;
    action: "archive" | "delete";
  } | null>(null);

  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.type !== "all") params.set("type", filter.type);
    if (filter.all) params.set("all", "1");
    try {
      const res = await fetch(`/api/memories?${params}`);
      const data = (await res.json()) as { memories: MemoryWithTags[] };
      setMemories(data.memories ?? []);
    } catch {
      showToast("加载记忆列表失败", "error");
    } finally {
      setLoading(false);
    }
  }, [filter, showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (filter.type !== "all") params.set("type", filter.type);
      if (filter.all) params.set("all", "1");
      try {
        const res = await fetch(`/api/memories?${params}`);
        const data = (await res.json()) as { memories: MemoryWithTags[] };
        if (!cancelled) {
          setMemories(data.memories ?? []);
        }
      } catch {
        if (!cancelled) {
          showToast("加载记忆列表失败", "error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, showToast]);

  // Filter by query (title + content + tags)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }, [memories, query]);

  // Group by year-month for timeline
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
    [filtered]
  );

  async function quickAdd() {
    const content = quickInput.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "claim", content }),
      });
      setQuickInput("");
      showToast("已成功记录一笔主张");
      load();
    } catch {
      showToast("添加失败", "error");
    } finally {
      setAdding(false);
    }
  }

  async function createDetailedMemory() {
    if (!newContent.trim()) return;
    try {
      const tagList = newTags
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          title: newTitle.trim() || undefined,
          content: newContent.trim(),
          theme: newTheme || undefined,
          tags: tagList.length > 0 ? tagList : undefined,
        }),
      });

      setNewModalOpen(false);
      setNewTitle("");
      setNewContent("");
      setNewTheme("");
      setNewTags("");
      showToast("记忆添加成功");
      load();
    } catch {
      showToast("创建失败", "error");
    }
  }

  async function executeAction() {
    if (!actionTarget) return;
    try {
      if (actionTarget.action === "delete") {
        await fetch(`/api/memories/${actionTarget.id}`, { method: "DELETE" });
        showToast("记忆已删除");
      } else {
        await fetch(`/api/memories/${actionTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        showToast("记忆已归档");
      }
      load();
    } catch {
      showToast("操作失败", "error");
    } finally {
      setActionTarget(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            "fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all animate-in fade-in slide-in-from-top-2",
            toast.type === "success"
              ? "bg-surface-2 border border-accent/40 text-foreground"
              : "bg-danger text-white"
          )}
        >
          {toast.type === "success" ? (
            <Check className="h-4 w-4 text-accent" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {toast.text}
        </div>
      )}

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {/* Header Title & Philosophy */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Brain className="h-6 w-6 text-accent" />
              <span>结构化记忆库</span>
            </h1>
            <p className="mt-1 text-xs text-muted">
              记录价值观、关键决定、认知演变与开放回路 · 被推翻的主张永不隐去
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setNewModalOpen(true)}
            className="self-start sm:self-auto gap-1.5 h-8 text-xs px-3"
          >
            <Plus className="h-4 w-4" />
            <span>新建记忆</span>
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            label="总记忆条数"
            value={stats.total}
            icon={Layers}
          />
          <StatCard
            label="关键决定"
            value={stats.decisions}
            icon={Check}
            accent
          />
          <StatCard
            label="开放回路 (待解决)"
            value={stats.openLoops}
            icon={FileQuestion}
            highlight={stats.openLoops > 0}
          />
          <StatCard
            label="已推翻认知 (认知跃迁)"
            value={stats.superseded}
            icon={ShieldAlert}
            muted
          />
        </div>

        {/* Quick Add Bar */}
        <div className="mt-5 rounded-xl border border-border bg-surface p-2.5 sm:p-3 focus-within:border-accent/50 transition-colors">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && quickAdd()}
              placeholder="快速记一笔此刻的想法、决定或纠结（按 Enter 快速存为主张）..."
              className="flex-1 rounded-lg border border-border/80 bg-background/50 px-3.5 py-2 text-xs sm:text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-accent"
            />
            <Button
              onClick={quickAdd}
              disabled={!quickInput.trim() || adding}
              variant="primary"
              size="sm"
              className="h-9 px-4 text-xs font-medium shrink-0"
            >
              {adding ? "记录中..." : "随手记"}
            </Button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="mt-4 space-y-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索记忆：内容、标题、标签、人生领域..."
              className="w-full rounded-xl border border-border bg-surface py-2 pl-10 pr-9 text-xs sm:text-sm text-foreground outline-none placeholder:text-muted/60 focus:border-accent"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Type Filter Chips (Horizontal Scroll on Mobile) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar flex-1">
              {TYPE_ORDER.map((item) => {
                const isSelected = filter.type === item.type;
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    onClick={() => setFilter((f) => ({ ...f, type: item.type }))}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all shrink-0 cursor-pointer border",
                      isSelected
                        ? "bg-accent-soft text-accent border-accent/40 shadow-xs"
                        : "bg-surface text-muted border-border hover:text-foreground hover:bg-surface-hover"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted shrink-0 pl-2">
              <input
                type="checkbox"
                checked={filter.all}
                onChange={(e) => setFilter((f) => ({ ...f, all: e.target.checked }))}
                className="rounded border-border accent-accent h-3.5 w-3.5"
              />
              <span className="hidden sm:inline">含归档/推翻</span>
              <span className="sm:hidden">全部态</span>
            </label>
          </div>
        </div>

        {/* Timeline Content */}
        {loading ? (
          <div className="mt-8 space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-border bg-surface/60"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-12 text-center py-12 rounded-2xl border border-dashed border-border bg-surface/30">
            <Brain className="mx-auto h-8 w-8 text-muted/60 mb-3" />
            <p className="text-sm font-medium text-foreground">
              {query ? `未找到匹配「${query}」的记忆` : "记忆库尚空"}
            </p>
            <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
              在上方直接记录想法，或者去「对话」页面与思考伙伴深入探讨，结束后自动提取沉淀。
            </p>
          </div>
        ) : (
          <div className="mt-6 pb-20 space-y-8">
            {groups.map(([month, items]) => (
              <section key={month} className="relative space-y-3">
                {/* Month sticky badge */}
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                  <div className="flex items-center gap-1.5 rounded-md bg-surface-2 border border-border px-2.5 py-1 text-xs font-semibold tracking-wide text-accent">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{month.replace("-", " 年 ")} 月</span>
                  </div>
                  <span className="text-[11px] font-medium text-muted">{items.length} 条记录</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Items in Month */}
                <div className="grid grid-cols-1 gap-3">
                  {items.map((m) => (
                    <MemoryCard
                      key={m.id}
                      m={m}
                      onArchive={() =>
                        setActionTarget({
                          id: m.id,
                          title: m.title || m.content.slice(0, 20),
                          action: "archive",
                        })
                      }
                      onDelete={() =>
                        setActionTarget({
                          id: m.id,
                          title: m.title || m.content.slice(0, 20),
                          action: "delete",
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* New Memory Modal */}
      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="max-w-lg w-[92vw]">
          <DialogHeader>
            <DialogTitle>新建记忆条目</DialogTitle>
            <DialogDescription>
              将你的核心主张、重大抉择或开放回路结构化沉淀至大脑中
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-3 text-xs">
            {/* Memory Type */}
            <div>
              <label className="block text-muted font-medium mb-1.5">记忆类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(
                  [
                    "claim",
                    "decision",
                    "value",
                    "question",
                    "insight",
                    "pattern",
                    "profile",
                  ] as MemoryType[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={cn(
                      "rounded-lg p-2 text-left border transition-all text-xs",
                      newType === t
                        ? "border-accent bg-accent-soft text-accent font-medium"
                        : "border-border bg-surface text-muted hover:text-foreground"
                    )}
                  >
                    {MEMORY_TYPE_LABELS[t] ?? t}
                  </button>
                ))}
              </div>
            </div>

            {/* Title (Optional) */}
            <div>
              <label className="block text-muted font-medium mb-1">标题（选填）</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例如：关于创业方向的选择 / 消费观的重塑"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
              />
            </div>

            {/* Content (Required) */}
            <div>
              <label className="block text-muted font-medium mb-1">
                核心内容 <span className="text-accent">*</span>
              </label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={3}
                placeholder="具体描述你的思考、论据、关键决定或当下困惑..."
                className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground outline-none focus:border-accent resize-none"
              />
            </div>

            {/* Life Domain / Theme */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-muted font-medium mb-1">生活领域（选填）</label>
                <select
                  value={newTheme}
                  onChange={(e) => setNewTheme(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground outline-none focus:border-accent"
                >
                  <option value="">未指定领域</option>
                  {Object.entries(THEME_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-muted font-medium mb-1">标签（逗号分隔）</label>
                <input
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="例如：职业规划, 投资, 习惯"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewModalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={createDetailedMemory}
              disabled={!newContent.trim()}
            >
              保存至记忆库
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive / Delete Confirmation Dialog */}
      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionTarget?.action === "delete" ? "删除记忆" : "归档记忆"}
            </DialogTitle>
            <DialogDescription>
              {actionTarget?.action === "delete"
                ? `确定要彻底删除「${actionTarget?.title}」吗？此操作不可撤销。`
                : `确定要归档「${actionTarget?.title}」吗？归档后该记忆在常规检索中降低权重，但保留在库中。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionTarget(null)}>
              取消
            </Button>
            <Button
              variant={actionTarget?.action === "delete" ? "danger" : "primary"}
              size="sm"
              onClick={executeAction}
            >
              {actionTarget?.action === "delete" ? "确认删除" : "确认归档"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  highlight,
  muted,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent?: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 sm:p-3.5 transition-all bg-surface",
        highlight
          ? "border-accent/40 bg-accent-soft/30"
          : "border-border hover:border-accent/25"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted font-medium truncate">{label}</span>
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            highlight ? "text-accent" : accent ? "text-accent" : "text-muted/60"
          )}
        />
      </div>
      <div
        className={cn(
          "mt-2 text-xl font-bold tracking-tight",
          highlight ? "text-accent" : accent ? "text-accent" : muted ? "text-muted" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MemoryCard({
  m,
  onArchive,
  onDelete,
}: {
  m: MemoryWithTags;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const superseded = m.status === "superseded";
  const archived = m.status === "archived";

  return (
    <div
      className={cn(
        "group rounded-xl border p-4 transition-all",
        superseded || archived
          ? "border-border/60 bg-surface/40 opacity-70"
          : "border-border bg-surface hover:border-accent/30 hover:shadow-xs"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Metadata badges row */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <Badge variant="accent" className="font-normal text-[10px] py-0 px-2">
              {MEMORY_TYPE_LABELS[m.type] ?? m.type}
            </Badge>

            {m.theme && (
              <Badge variant="outline" className="text-[10px] py-0 px-2 font-normal">
                {THEME_LABELS[m.theme as keyof typeof THEME_LABELS] ?? m.theme}
              </Badge>
            )}

            <span className="text-muted/80 flex items-center gap-1">
              <Calendar className="h-3 w-3 inline" />
              {(m.valid_from ?? m.created_at).slice(0, 10)}
            </span>

            {superseded && (
              <Badge variant="danger" className="text-[10px] py-0 px-1.5 font-normal">
                已被推翻
              </Badge>
            )}

            {archived && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal text-muted">
                已归档
              </Badge>
            )}
          </div>

          {/* Title if present */}
          {m.title && (
            <h4
              className={cn(
                "mt-2 text-sm font-semibold text-foreground tracking-tight",
                superseded && "line-through decoration-muted text-muted"
              )}
            >
              {m.title}
            </h4>
          )}

          {/* Content */}
          <p
            className={cn(
              "mt-1.5 whitespace-pre-wrap text-xs sm:text-[13px] leading-relaxed text-foreground/90",
              superseded && "text-muted line-through decoration-muted/60"
            )}
          >
            {m.content}
          </p>

          {/* Tags */}
          {(m.tags?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Tag className="h-3 w-3 text-muted/60" />
              {m.tags!.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-muted font-mono"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons (Desktop on hover, always visible on mobile) */}
        <div className="flex sm:opacity-0 sm:group-hover:opacity-100 transition-opacity gap-1 shrink-0">
          {!archived && !superseded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onArchive}
              className="h-7 px-2 text-[11px] text-muted hover:text-foreground"
              title="归档此记忆"
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              <span>归档</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-7 px-2 text-[11px] text-muted hover:text-danger hover:bg-danger-soft"
            title="删除此记忆"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            <span>删除</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
