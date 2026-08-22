"use client";

import { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  Palette,
  Cpu,
  Layers,
  Sparkles,
  Database,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Check,
  Zap,
} from "lucide-react";
import { useTheme, THEMES } from "@/components/theme-context";
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

interface RoleView {
  model?: string;
  baseUrl?: string;
  apiKeyMasked?: string;
  dimensions?: number;
}

interface SettingsView {
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  model: string;
  roles: Record<"thinker" | "extractor" | "embedder", RoleView | undefined>;
  embedder?: {
    model: string;
    baseUrl: string;
    dimensions: number;
    ready: boolean;
    hasApiKey: boolean;
  } | null;
}

type RoleKey = "thinker" | "extractor";

const ROLE_META: Array<{ key: RoleKey; label: string; hint: string }> = [
  {
    key: "thinker",
    label: "thinker · 对话与思考",
    hint: "建议用最强的推理模型（如 Claude 3.7 / deepseek-r1 / GPT-4o 等），支持多模态更佳。",
  },
  {
    key: "extractor",
    label: "extractor · 记忆整理与提炼",
    hint: "在会话结束后从对话中提取关键主张、决策与纠结，使用轻量快速模型即可。",
  },
];

const EMPTY_ROLE = { model: "", baseUrl: "", apiKey: "" };
const EMPTY_EMBED = { model: "", baseUrl: "", apiKey: "", dimensions: "" };

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<SettingsView | null>(null);
  const [g, setG] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [roles, setRoles] = useState<Record<RoleKey, typeof EMPTY_ROLE>>({
    thinker: { ...EMPTY_ROLE },
    extractor: { ...EMPTY_ROLE },
  });
  const [embed, setEmbed] = useState({ ...EMPTY_EMBED });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexConfirmOpen, setReindexConfirmOpen] = useState(false);
  const [resetRoleTarget, setResetRoleTarget] = useState<RoleKey | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // Import confirmation modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  function showToast(text: string, ok: boolean = true) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    try {
      const res = await fetch("/api/settings");
      const d = (await res.json()) as SettingsView;
      setView(d);
      setG({ baseUrl: d.baseUrl, apiKey: "", model: d.model });
      setRoles({
        thinker: { ...EMPTY_ROLE },
        extractor: { ...EMPTY_ROLE },
      });
      setEmbed({
        model: d.roles?.embedder?.model ?? "",
        baseUrl: d.roles?.embedder?.baseUrl ?? "",
        apiKey: "",
        dimensions: d.roles?.embedder?.dimensions?.toString() ?? "",
      });
    } catch {
      showToast("加载设置失败", false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        const d = (await res.json()) as SettingsView;
        if (!active) return;
        setView(d);
        setG({ baseUrl: d.baseUrl, apiKey: "", model: d.model });
        setRoles({
          thinker: { ...EMPTY_ROLE },
          extractor: { ...EMPTY_ROLE },
        });
        setEmbed({
          model: d.roles?.embedder?.model ?? "",
          baseUrl: d.roles?.embedder?.baseUrl ?? "",
          apiKey: "",
          dimensions: d.roles?.embedder?.dimensions?.toString() ?? "",
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...g,
          roles: {
            ...roles,
            embedder: {
              model: embed.model,
              baseUrl: embed.baseUrl,
              apiKey: embed.apiKey,
              dimensions: embed.dimensions,
            },
          },
        }),
      });
      showToast("设置已保存并生效");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存设置失败", false);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/test", { method: "POST" });
      const d = (await res.json()) as { ok: boolean; reply?: string; error?: string };
      if (d.ok) {
        showToast(`AI 连接成功：${d.reply ?? "正常响应"}`);
      } else {
        showToast(`连接失败：${d.error ?? res.status}`, false);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "测试连接出错", false);
    } finally {
      setTesting(false);
    }
  }

  async function reindex() {
    setReindexing(true);
    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      const d = (await res.json()) as { ok: boolean; done?: number; error?: string };
      if (!d.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      showToast(`向量化完成：本轮嵌入 ${d.done ?? 0} 条记忆`);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "向量化失败", false);
    } finally {
      setReindexing(false);
    }
  }

  async function resetRole(role: RoleKey) {
    setRoles((prev) => ({ ...prev, [role]: { ...EMPTY_ROLE } }));
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: { [role]: { model: "", baseUrl: "", apiKey: "__CLEAR__" } } }),
      });
      showToast(`已重置 ${role} 角色为继承全局配置`);
      load();
    } catch {
      showToast("重置失败", false);
    }
  }

  function exportData() {
    const a = document.createElement("a");
    a.href = "/api/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("正在下载完整数据备份快照...");
  }

  async function handleFileSelected(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { app?: string; version?: number };
      if (parsed.app !== "mine-brain" || parsed.version !== 1) {
        showToast("该文件不是合法的 mine-brain 备份文件", false);
        return;
      }
      setPendingImportFile(file);
      setImportModalOpen(true);
    } catch {
      showToast("解析备份文件失败，请确认是否为有效 JSON", false);
    }
  }

  async function confirmImport() {
    if (!pendingImportFile || importing) return;
    setImporting(true);
    try {
      const text = await pendingImportFile.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const d = (await res.json()) as { ok?: boolean; counts?: Record<string, number>; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const c = d.counts ?? {};
      showToast(`导入完成：恢复记忆 ${c.memories ?? 0} 条、对话消息 ${c.messages ?? 0} 条`);
      setImportModalOpen(false);
      setPendingImportFile(null);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "导入数据出错", false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            "fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs sm:text-sm font-medium shadow-lg transition-all animate-in fade-in slide-in-from-top-2",
            toast.ok
              ? "bg-surface-2 border border-accent/40 text-foreground"
              : "bg-danger text-white"
          )}
        >
          {toast.ok ? (
            <CheckCircle2 className="h-4 w-4 text-accent" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          {toast.text}
        </div>
      )}

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 pb-24">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border pb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <SettingsIcon className="h-6 w-6 text-accent" />
              <span>系统与模型设置</span>
            </h1>
            <p className="mt-1 text-xs text-muted">
              AI 提供商与角色完全解耦 · 本地化数据完全属于你
            </p>
          </div>
        </div>

        {/* 1. Theme Selection Section */}
        <section className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Palette className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">视觉主题 (5 套定制美学)</h2>
          </div>
          <p className="text-xs text-muted leading-relaxed mb-4">
            为长文本思考而设计的定制调色板，支持零闪烁持久化。
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {THEMES.map((opt) => {
              const active = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTheme(opt.id)}
                  className={cn(
                    "flex flex-col items-start rounded-xl p-3 text-left border transition-all cursor-pointer relative",
                    active
                      ? "border-accent bg-accent-soft shadow-xs"
                      : "border-border bg-surface-2 hover:border-accent/40 hover:bg-surface-hover"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-black/20 shadow-xs"
                      style={{ backgroundColor: opt.accentHex }}
                    />
                    {active && <Check className="h-3.5 w-3.5 text-accent" />}
                  </div>
                  <span className="text-xs font-semibold text-foreground tracking-tight">
                    {opt.name}
                  </span>
                  <span className="text-[10px] text-muted mt-0.5 leading-tight">
                    {opt.enName}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Global Provider Section */}
        <section className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-foreground">全局 AI Provider</h2>
            </div>
            <Badge variant="outline" className="text-[10px] font-normal">
              默认通用兜底
            </Badge>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            兼容任意标准 OpenAI 协议端点（OpenAI、Anthropic 兼容代理、DeepSeek、Ollama 等）。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Base URL" hint="API 地址前缀">
              <input
                value={g.baseUrl}
                onChange={(e) => setG((v) => ({ ...v, baseUrl: e.target.value }))}
                placeholder="https://opencode.ai/zen/v1"
                className={inputCls}
              />
            </Field>
            <Field
              label="API Key"
              hint={view ? (view.hasApiKey ? `已存 (${view.apiKeyMasked})` : "未配置") : undefined}
            >
              <input
                value={g.apiKey}
                onChange={(e) => setG((v) => ({ ...v, apiKey: e.target.value }))}
                type="password"
                placeholder={view?.hasApiKey ? "留空表示不修改" : "sk-..."}
                className={inputCls}
              />
            </Field>
            <Field label="默认模型" hint="作为所有未指定角色的模型">
              <input
                value={g.model}
                onChange={(e) => setG((v) => ({ ...v, model: e.target.value }))}
                placeholder="x-preview-f-free"
                className={inputCls}
              />
            </Field>
          </div>
        </section>

        {/* 3. Role-Based Overrides */}
        <section className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">按角色细分覆盖（可选）</h2>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            thinker 与 extractor 可各自指定独立服务商或模型。留空即自动继承上方全局 Provider。
          </p>

          <div className="space-y-3 mt-3">
            {ROLE_META.map(({ key, label, hint }) => {
              const customModel = view?.roles?.[key]?.model;
              return (
                <div
                  key={key}
                  className="rounded-lg border border-border bg-surface-2/60 p-3.5 transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-foreground">{label}</span>
                      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setResetRoleTarget(key)}
                      className="h-6 px-2 text-[11px] text-muted hover:text-accent"
                    >
                      恢复继承全局
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <Field label="模型覆盖">
                      <input
                        value={roles[key].model}
                        onChange={(e) =>
                          setRoles((v) => ({
                            ...v,
                            [key]: { ...v[key], model: e.target.value },
                          }))
                        }
                        placeholder={customModel || "继承全局"}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Base URL 覆盖">
                      <input
                        value={roles[key].baseUrl}
                        onChange={(e) =>
                          setRoles((v) => ({
                            ...v,
                            [key]: { ...v[key], baseUrl: e.target.value },
                          }))
                        }
                        placeholder={view?.roles?.[key]?.baseUrl || "继承全局"}
                        className={inputCls}
                      />
                    </Field>
                    <Field
                      label="API Key 覆盖"
                      hint={view?.roles?.[key]?.apiKeyMasked ? "已自定义" : undefined}
                    >
                      <input
                        value={roles[key].apiKey}
                        onChange={(e) =>
                          setRoles((v) => ({
                            ...v,
                            [key]: { ...v[key], apiKey: e.target.value },
                          }))
                        }
                        type="password"
                        placeholder="留空表示不改"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 4. Vector Embedder Section */}
        <section className="mt-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-foreground">向量检索 (Embedder)</h2>
            </div>
            {view?.embedder && (
              <Badge
                variant={view.embedder.ready ? "accent" : "outline"}
                className="text-[10px]"
              >
                {view.embedder.ready ? "向量能力已就绪" : "未配置 Key (自动降级为词法检索)"}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted leading-relaxed">
            独立于对话 Provider——多数对话服务商无 embeddings 端点。默认支持阿里云百炼
            <code className="text-accent bg-accent-soft px-1 rounded mx-1">qwen3.7-text-embedding</code>
            （1024维）。
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <Field label="嵌入模型">
              <input
                value={embed.model}
                onChange={(e) => setEmbed((v) => ({ ...v, model: e.target.value }))}
                placeholder={view?.embedder?.model || "qwen3.7-text-embedding"}
                className={inputCls}
              />
            </Field>
            <Field label="Base URL">
              <input
                value={embed.baseUrl}
                onChange={(e) => setEmbed((v) => ({ ...v, baseUrl: e.target.value }))}
                placeholder={view?.embedder?.baseUrl || ".../compatible-mode/v1"}
                className={inputCls}
              />
            </Field>
            <Field label="API Key" hint={view?.roles?.embedder?.apiKeyMasked ? "已配置" : "百炼/兼容Key"}>
              <input
                value={embed.apiKey}
                onChange={(e) => setEmbed((v) => ({ ...v, apiKey: e.target.value }))}
                type="password"
                placeholder="留空表示不改"
                className={inputCls}
              />
            </Field>
            <Field label="向量维度" hint="更改将自动失效旧向量">
              <input
                value={embed.dimensions}
                onChange={(e) =>
                  setEmbed((v) => ({
                    ...v,
                    dimensions: e.target.value.replace(/\D/g, "").slice(0, 4),
                  }))
                }
                placeholder="1024"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/60 pt-3">
            <div className="text-[11px] text-muted">
              {view?.embedder ? (
                <span>
                  当前设定：<span className="text-accent font-medium">{view.embedder.model}</span>
                  {" · "}
                  {view.embedder.dimensions} 维{" · "}
                  {view.embedder.ready ? "余弦相似度第5信号已激活" : "缺少 API Key 暂未激活"}
                </span>
              ) : (
                <span>未初始化嵌入配置</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReindexConfirmOpen(true)}
              disabled={reindexing || !view?.embedder?.ready}
              className="gap-1.5 h-8 text-xs shrink-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", reindexing && "animate-spin")} />
              <span>{reindexing ? "正在重新嵌入..." : "全量重新向量化"}</span>
            </Button>
          </div>
        </section>

        {/* Actions Row */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={save}
            disabled={saving}
            className="px-6 h-9 font-medium"
          >
            {saving ? "正在保存..." : "保存所有配置"}
          </Button>

          <Button
            variant="outline"
            onClick={testConnection}
            disabled={testing}
            className="h-9 px-4 gap-1.5"
          >
            <Zap className="h-3.5 w-3.5 text-accent" />
            <span>{testing ? "测试中..." : "测试 AI 连接"}</span>
          </Button>
        </div>

        {/* 5. Data Sovereignty & Export */}
        <section className="mt-8 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">数据主权与备份迁移</h2>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            所有思考数据均保存在本地 SQLite 数据库中。导出快照自动对 API Key 脱敏；导入恢复前会自动备份当前数据库。
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={exportData}
              className="gap-1.5 text-xs h-9"
            >
              <Download className="h-3.5 w-3.5 text-accent" />
              <span>导出全部数据快照 (JSON)</span>
            </Button>

            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="gap-1.5 text-xs h-9"
            >
              <Upload className="h-3.5 w-3.5 text-accent" />
              <span>导入备份快照 (覆盖恢复)</span>
            </Button>
          </div>
        </section>
      </div>

      {/* Import Confirmation Dialog */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <ShieldCheck className="h-5 w-5 text-accent" />
              <span>确认恢复备份数据</span>
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-xs">
              <p>
                导入将覆盖当前全部数据（包括会话、记忆条目和设置）。
              </p>
              <p className="text-muted">
                系统在导入前会在 <code className="bg-surface-2 px-1 rounded">data/backups/</code> 自动生成当前数据库的完全备份。
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportModalOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={confirmImport}
              disabled={importing}
            >
              {importing ? "正在恢复..." : "确认导入覆盖"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reindex Confirmation Dialog */}
      <Dialog open={reindexConfirmOpen} onOpenChange={setReindexConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-accent" />
              <span>全量重新向量化确认</span>
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-xs">
              <p>
                将对记忆库中的全部记忆调用向量模型（
                <span className="text-accent font-medium">{view?.embedder?.model || "qwen3.7-text-embedding"}</span>
                ）重新生成嵌入向量。
              </p>
              <p className="text-muted">
                此操作将按当前模型与维度更新索引，通常在切换了嵌入模型或调整维度后执行。
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReindexConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setReindexConfirmOpen(false);
                reindex();
              }}
            >
              确认开始向量化
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Role Confirmation Dialog */}
      <Dialog open={!!resetRoleTarget} onOpenChange={(open) => !open && setResetRoleTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>恢复继承全局配置？</DialogTitle>
            <DialogDescription className="text-xs pt-1 text-muted">
              确定要清空「{resetRoleTarget}」的独立模型与 API 覆盖配置吗？重置后该角色将自动继承全局 Provider。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setResetRoleTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (resetRoleTarget) {
                  resetRole(resetRoleTarget);
                  setResetRoleTarget(null);
                }
              }}
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground outline-none placeholder:text-muted/50 focus:border-accent transition-colors";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted truncate ml-1">{hint}</span>}
      </div>
      <div>{children}</div>
    </label>
  );
}
