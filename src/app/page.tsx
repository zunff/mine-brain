"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/markdown";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  images?: string[];
  ts?: string;
}

interface SessionItem {
  id: number;
  title: string;
  updated_at: string;
}

const LS_KEY = "mb_last_session";
const MAX_IMAGES = 4;

const SUGGESTIONS = [
  "我最近反复在想一件事，但一直没想清楚……",
  "帮我复盘一个最近做的决定。",
  "有个纠结憋了很久，说出来你帮我对照一下过去。",
];

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [live, setLive] = useState<{ content: string; reasoning: string } | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    const data = (await res.json()) as { sessions: SessionItem[] };
    setSessions(data.sessions ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d: { hasProfile: boolean }) => setNeedsOnboarding(!d.hasProfile))
      .catch(() => {});
    refreshSessions();
    // 会话恢复：刷新后回到上次对话
    const saved = Number(window.localStorage.getItem(LS_KEY));
    if (Number.isInteger(saved) && saved > 0) openSession(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, live]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function openSession(id: number) {
    if (busy) return;
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: Array<ChatMsg & { images: string | null; created_at: string }>;
    };
    setSessionId(id);
    window.localStorage.setItem(LS_KEY, String(id));
    setMessages(
      data.messages.map((m) => ({
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        images: m.images ? (JSON.parse(m.images) as string[]) : undefined,
        ts: m.created_at,
      })),
    );
    setLive(null);
  }

  function newChat() {
    if (busy) return;
    setSessionId(null);
    window.localStorage.removeItem(LS_KEY);
    setMessages([]);
    setLive(null);
    setImages([]);
  }

  async function renameSession(id: number, current: string) {
    const title = window.prompt("重命名对话", current);
    if (!title?.trim()) return;
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    refreshSessions();
  }

  async function deleteSession(id: number) {
    if (!window.confirm("删除这个对话？（记忆资产会保留）")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (id === sessionId) newChat();
    refreshSessions();
  }

  async function addImageFiles(files: FileList | File[]) {
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return;
    const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    for (const f of picked) {
      if (f.size > 4 * 1024 * 1024) {
        setToast(`图片 ${f.name} 超过 4MB，已跳过`);
        continue;
      }
      const uri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, uri]));
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && images.length === 0) || busy) return;
    setInput("");
    const sentImages = images;
    setImages([]);
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text || "（图片）", images: sentImages, ts: new Date().toISOString() },
    ]);
    setLive({ content: "", reasoning: "" });

    let accContent = "";
    let accReasoning = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, images: sentImages }),
      });
      if (!res.body) throw new Error("no stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim()) as {
            type: string;
            text?: string;
            sessionId?: number;
            memoriesAdded?: number;
          };
          if (evt.type === "meta" && evt.sessionId) {
            setSessionId(evt.sessionId);
            window.localStorage.setItem(LS_KEY, String(evt.sessionId));
          } else if (evt.type === "content" && evt.text) {
            accContent += evt.text;
            setLive({ content: accContent, reasoning: accReasoning });
          } else if (evt.type === "reasoning" && evt.text) {
            accReasoning += evt.text;
            setLive({ content: accContent, reasoning: accReasoning });
          } else if (evt.type === "done") {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: accContent,
                reasoning: accReasoning || null,
                ts: new Date().toISOString(),
              },
            ]);
            setLive(null);
            if ((evt.memoriesAdded ?? 0) > 0) {
              setToast(`已沉淀 ${evt.memoriesAdded} 条新记忆`);
              setTimeout(() => setToast(null), 3500);
            }
            refreshSessions();
          }
        }
      }
    } catch (err) {
      const fallback =
        accContent ||
        `连接出错：${err instanceof Error ? err.message : String(err)}。请检查「设置」里的 AI 配置。`;
      setMessages((prev) => [...prev, { role: "assistant", content: fallback }]);
      setLive(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full min-w-0">
      {/* 会话列表 */}
      <div className="hidden w-60 shrink-0 flex-col border-r border-borderline bg-surface/50 md:flex">
        <div className="p-3">
          <button
            onClick={newChat}
            disabled={busy}
            className="w-full rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent transition hover:bg-accent hover:text-background disabled:opacity-40"
          >
            ＋ 新对话
          </button>
        </div>
        <div className="group/sessions flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group/item relative rounded-md transition-colors ${
                s.id === sessionId ? "bg-surface-2" : "hover:bg-surface-2/60"
              }`}
            >
              <button
                onClick={() => openSession(s.id)}
                className={`block w-full truncate py-2 pl-3 pr-14 text-left text-[13px] ${
                  s.id === sessionId ? "text-foreground" : "text-muted"
                }`}
                title={s.title}
              >
                {s.title}
              </button>
              <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover/item:flex">
                <button
                  onClick={() => renameSession(s.id, s.title)}
                  title="重命名"
                  className="rounded p-1 text-[11px] text-muted hover:text-accent"
                >
                  ✎
                </button>
                <button
                  onClick={() => deleteSession(s.id)}
                  title="删除"
                  className="rounded p-1 text-[11px] text-muted hover:text-red-400"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-4 text-xs leading-relaxed text-muted">
              还没有对话。第一次深聊从下面开始。
            </p>
          )}
        </div>
      </div>

      {/* 对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {needsOnboarding && (
          <div className="border-b border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-accent">
            大脑还是空白的。先花两分钟{" "}
            <Link href="/onboarding" className="underline underline-offset-2">
              告诉它你是谁
            </Link>
            ，它会更懂你；也可以直接开聊。
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages.length === 0 && !live && (
              <div className="mt-24 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">今天在想什么？</h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                  说模糊的念头也行，说不完整的情绪也行。
                  这里不是搜索引擎——我会记住你，对照你的过去，也会在需要的时候反驳你。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full border border-borderline px-3.5 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-5">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%]">
                      {m.images && m.images.length > 0 && (
                        <div className="mb-1.5 flex justify-end gap-1.5">
                          {m.images.map((src, j) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={j}
                              src={src}
                              alt=""
                              className="h-20 w-20 rounded-lg border border-borderline object-cover"
                            />
                          ))}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-2 px-4 py-2.5 text-[14px] leading-relaxed">
                        {m.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <AssistantBubble key={i} msg={m} />
                ),
              )}
              {live && (
                <AssistantBubble
                  msg={{ role: "assistant", content: live.content, reasoning: live.reasoning }}
                  streaming
                />
              )}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-borderline bg-surface/60 p-3">
          {images.length > 0 && (
            <div className="mx-auto mb-2 flex max-w-3xl gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="h-16 w-16 rounded-lg border border-borderline object-cover"
                  />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-borderline bg-background text-xs text-muted hover:text-red-400"
                    aria-label="移除图片"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => e.target.files && addImageFiles(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy || images.length >= MAX_IMAGES}
              title="添加图片"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-borderline text-lg text-muted transition hover:border-accent/40 hover:text-accent disabled:opacity-30"
            >
              ＋
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.items]
                  .filter((it) => it.kind === "file")
                  .map((it) => it.getAsFile())
                  .filter((f): f is File => !!f);
                if (files.length > 0) {
                  e.preventDefault();
                  addImageFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={Math.min(5, Math.max(1, input.split("\n").length))}
              placeholder="把此刻的想法丢进来……（Enter 发送，Shift+Enter 换行，可粘贴截图）"
              className="max-h-36 min-h-[44px] flex-1 resize-none rounded-lg border border-borderline bg-background px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted/60 focus:border-accent/50"
              disabled={busy}
            />
            <button
              onClick={send}
              disabled={busy || (!input.trim() && images.length === 0)}
              className="h-11 shrink-0 rounded-lg bg-accent px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-30"
            >
              {busy ? "思考中…" : "发送"}
            </button>
          </div>
        </div>
      </div>

      {/* 移动端新对话入口 */}
      <button
        onClick={newChat}
        disabled={busy}
        className="fixed bottom-20 right-4 z-10 h-12 w-12 rounded-full border border-accent/40 bg-accent-soft text-lg text-accent md:hidden"
        aria-label="新对话"
      >
        ＋
      </button>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-accent/40 bg-surface px-4 py-2 text-xs text-accent shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function AssistantBubble({
  msg,
  streaming,
}: {
  msg: ChatMsg;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略 */
    }
  }
  return (
    <div className="group/msg flex gap-3">
      <div className="mt-1 h-7 w-7 shrink-0 rounded-full border border-accent/50 bg-accent-soft pt-0.5 text-center text-sm leading-none text-accent">
        ◇
      </div>
      <div className="min-w-0 max-w-[90%]">
        {msg.reasoning && (
          <details className="mb-2">
            <summary className="cursor-pointer select-none text-xs text-muted transition-colors hover:text-accent">
              思考过程 {streaming ? "…" : ""}
            </summary>
            <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-borderline/60 bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
              {msg.reasoning}
            </div>
          </details>
        )}
        {msg.content ? (
          <Markdown content={msg.content} />
        ) : streaming ? (
          <span className="text-sm text-muted">…</span>
        ) : null}
        {!streaming && msg.content && (
          <button
            onClick={copy}
            className="mt-1.5 text-[11px] text-transparent transition-colors group-hover/msg:text-muted hover:!text-accent"
          >
            {copied ? "已复制" : "复制"}
          </button>
        )}
      </div>
    </div>
  );
}
