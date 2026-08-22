"use client";

import { useEffect, useState } from "react";

interface SettingsView {
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  model: string;
}

export default function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch("/api/settings");
    const d = (await res.json()) as SettingsView;
    setView(d);
    setBaseUrl(d.baseUrl);
    setModel(d.model);
    setApiKey("");
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
        body: JSON.stringify({ baseUrl, apiKey, model }),
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

  function exportData() {
    window.location.href = "/api/export";
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          AI 服务商随时可换——这里改的是「角色配置」，业务逻辑不绑定任何一家模型。
        </p>

        <section className="mt-6 space-y-4 rounded-xl border border-borderline bg-surface p-5">
          <h2 className="text-sm font-medium">AI Provider</h2>

          <Field label="Base URL">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://opencode.ai/zen/v1"
              className={inputCls}
            />
          </Field>

          <Field label="API Key" hint={view ? `当前：${view.apiKeyMasked || "未设置"}` : undefined}>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder={view?.hasApiKey ? "留空表示不修改" : "sk-…"}
              className={inputCls}
            />
          </Field>

          <Field label="默认模型" hint="thinker / extractor 角色共用；未来可在 DB 里按角色覆盖。">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="x-preview-f-free"
              className={inputCls}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
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
        </section>

        <section className="mt-6 rounded-xl border border-borderline bg-surface p-5">
          <h2 className="text-sm font-medium">数据主权</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            所有记忆都存在本地 data/ 目录的 SQLite 文件里。导出是完整 JSON 快照，
            包含全部历史与关联，不依赖任何云服务。
          </p>
          <button
            onClick={exportData}
            className="mt-3 rounded-lg border border-borderline px-5 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-foreground"
          >
            导出全部数据（JSON）
          </button>
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
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-muted/70">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
