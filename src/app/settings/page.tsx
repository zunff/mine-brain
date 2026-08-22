"use client";

import { useEffect, useRef, useState } from "react";

interface RoleView {
  model?: string;
  baseUrl?: string;
  apiKeyMasked?: string;
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

type RoleKey = "thinker" | "extractor" | "embedder";

const ROLE_META: Array<{ key: RoleKey; label: string; hint: string }> = [
  { key: "thinker", label: "thinker · 对话与思考", hint: "建议用最强的推理模型，支持 vision 更佳。" },
  { key: "extractor", label: "extractor · 记忆整理", hint: "轻量快模型即可。" },
  { key: "embedder", label: "embedder · 向量化", hint: "OpenAI 兼容 embeddings 端点（默认百炼 qwen3.7）。切换模型/维度后点「重新向量化」。" },
];

const EMPTY_ROLE = { model: "", baseUrl: "", apiKey: "" };

export default function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [g, setG] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [roles, setRoles] = useState<Record<RoleKey, typeof EMPTY_ROLE>>({
    thinker: { ...EMPTY_ROLE },
    extractor: { ...EMPTY_ROLE },
    embedder: { ...EMPTY_ROLE },
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/settings");
    const d = (await res.json()) as SettingsView;
    setView(d);
    setG({ baseUrl: d.baseUrl, apiKey: "", model: d.model });
    setRoles({
      thinker: { ...EMPTY_ROLE },
      extractor: { ...EMPTY_ROLE },
      embedder: { ...EMPTY_ROLE },
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...g, roles }),
      });
      setMsg({ ok: true, text: "已保存。" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/test", { method: "POST" });
      const d = (await res.json()) as { ok: boolean; reply?: string; error?: string };
      setMsg(
        d.ok
          ? { ok: true, text: `连接成功（${d.reply ?? ""}）` }
          : { ok: false, text: `失败：${d.error ?? res.status}` },
      );
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function reindex() {
    setImporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      const d = (await res.json()) as { ok: boolean; done?: number; error?: string };
      if (!d.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setMsg({ ok: true, text: `向量化完成（本轮嵌入 ${d.done ?? 0} 条）。` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
    }
  }

  async function resetRole(role: RoleKey) {
    setRoles((prev) => ({ ...prev, [role]: { ...EMPTY_ROLE } }));
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: { [role]: { model: "", baseUrl: "", apiKey: "__CLEAR__" } } }),
    });
    setMsg({ ok: true, text: `已重置 ${role} 为全局配置。` });
    load();
  }

  function exportData() {
    window.location.href = "/api/export";
  }

  async function onImportFile(file: File) {
    if (importing) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { app?: string; version?: number };
      if (parsed.app !== "mine-brain" || parsed.version !== 1) {
        throw new Error("不是有效的 mine-brain 导出文件");
      }
      if (!window.confirm("导入会覆盖当前全部数据（对话、记忆、设置）。\n系统会先在 data/backups/ 自动备份当前数据库。确定继续？")) {
        return;
      }
      setImporting(true);
      setMsg(null);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const d = (await res.json()) as { ok?: boolean; counts?: Record<string, number>; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const c = d.counts ?? {};
      setMsg({
        ok: true,
        text: `导入完成：记忆 ${c.memories ?? 0} 条、消息 ${c.messages ?? 0} 条。`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          AI 服务商随时可换——业务逻辑只声明角色，每个角色都可以指向不同的厂商。
        </p>

        <section className="mt-6 space-y-4 rounded-xl border border-borderline bg-surface p-5">
          <h2 className="text-sm font-medium">全局 Provider</h2>
          <Field label="Base URL">
            <input
              value={g.baseUrl}
              onChange={(e) => setG((v) => ({ ...v, baseUrl: e.target.value }))}
              placeholder="https://opencode.ai/zen/v1"
              className={inputCls}
            />
          </Field>
          <Field label="API Key" hint={view ? `当前：${view.apiKeyMasked || "未设置"}` : undefined}>
            <input
              value={g.apiKey}
              onChange={(e) => setG((v) => ({ ...v, apiKey: e.target.value }))}
              type="password"
              placeholder={view?.hasApiKey ? "留空表示不修改" : "sk-…"}
              className={inputCls}
            />
          </Field>
          <Field label="默认模型" hint="所有角色的兜底。">
            <input
              value={g.model}
              onChange={(e) => setG((v) => ({ ...v, model: e.target.value }))}
              placeholder="x-preview-f-free"
              className={inputCls}
            />
          </Field>
        </section>

        <section className="mt-4 space-y-3 rounded-xl border border-borderline bg-surface p-5">
          <h2 className="text-sm font-medium">按角色覆盖</h2>
          <p className="text-xs leading-relaxed text-muted">
            三项都可独立填写（留空 = 用全局）。典型用法：thinker 用 A 家旗舰、embedder 指向本地或另一家。
          </p>
          {ROLE_META.map(({ key, label, hint }) => (
            <div key={key} className="rounded-lg border border-borderline/60 bg-surface-2/40 p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-xs font-medium">{label}</span>
                  <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
                </div>
                <button
                  onClick={() => resetRole(key)}
                  className="shrink-0 rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-accent"
                >
                  重置
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="模型">
                  <input
                    value={roles[key].model}
                    onChange={(e) => setRoles((v) => ({ ...v, [key]: { ...v[key], model: e.target.value } }))}
                    placeholder={view?.roles?.[key]?.model || "用全局"}
                    className={inputCls}
                  />
                </Field>
                <Field label="Base URL">
                  <input
                    value={roles[key].baseUrl}
                    onChange={(e) => setRoles((v) => ({ ...v, [key]: { ...v[key], baseUrl: e.target.value } }))}
                    placeholder={view?.roles?.[key]?.baseUrl || "用全局"}
                    className={inputCls}
                  />
                </Field>
                <Field label="API Key" hint={view?.roles?.[key]?.apiKeyMasked}>
                  <input
                    value={roles[key].apiKey}
                    onChange={(e) => setRoles((v) => ({ ...v, [key]: { ...v[key], apiKey: e.target.value } }))}
                    type="password"
                    placeholder="留空=不改"
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          ))}
        </section>

        {/* embedder 运行状态与重嵌入 */}
        {view?.embedder && (
          <section className="mt-4 rounded-xl border border-borderline bg-surface p-5">
            <h2 className="text-sm font-medium">向量检索</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              当前 embedding：<span className="text-accent">{view.embedder.model}</span>
              （{view.embedder.dimensions} 维 · {view.embedder.baseUrl}）
              {view.embedder.ready
                ? " · 已启用，检索会叠加向量信号。"
                : " · API Key 未配置，向量信号暂未启用。"}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={reindex}
                disabled={importing || !view.embedder.ready}
                className="rounded-lg border border-borderline px-4 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-foreground disabled:opacity-30"
              >
                {importing ? "向量化中…" : "重新向量化"}
              </button>
              <span className="text-[11px] text-muted">
                切换模型或维度后点一次，旧向量自动失效
              </span>
            </div>
          </section>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-30"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            onClick={testConnection}
            disabled={testing}
            className="rounded-lg border border-borderline px-5 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-foreground disabled:opacity-30"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          {msg && (
            <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
              {msg.text}
            </span>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-borderline bg-surface p-5">
          <h2 className="text-sm font-medium">数据主权</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            所有记忆都存在本地 data/ 目录的 SQLite 文件里。导出是完整 JSON 快照（密钥自动脱敏）；
            导入会先自动备份再整体恢复，可在设备间迁移。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={exportData}
              className="rounded-lg border border-borderline px-5 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-foreground"
            >
              导出全部数据（JSON）
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
            />
            <button
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="rounded-lg border border-borderline px-5 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-foreground disabled:opacity-30"
            >
              {importing ? "导入中…" : "导入备份（覆盖恢复）"}
            </button>
          </div>
        </section>

        <div className="pb-16" />
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-borderline bg-background px-3.5 py-2.5 text-sm outline-none placeholder:text-muted/50 focus:border-accent/50";

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
      <span className="text-xs text-muted">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-muted/70">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
