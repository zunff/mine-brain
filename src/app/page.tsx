"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
}

interface SessionItem {
  id: number;
  title: string;
  updated_at: string;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [live, setLive] = useState<{ content: string; reasoning: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
  }, [refreshSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, live]);

  async function openSession(id: number) {
    if (busy) return;
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMsg[] };
    setSessionId(id);
    setMessages(
      data.messages.map((m) => ({ role: m.role, content: m.content, reasoning: m.reasoning })),
    );
    setLive(null);
  }

  function newChat() {
    if (busy) return;
    setSessionId(null);
    setMessages([]);
    setLive(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLive({ content: "", reasoning: "" });

    let accContent = "";
    let accReasoning = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
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
          } else if (evt.type === "content" && evt.text) {
            accContent += evt.text;
            setLive({ content: accContent, reasoning: accReasoning });
          } else if (evt.type === "reasoning" && evt.text) {
            accReasoning += evt.text;
            setLive({ content: accContent, reasoning: accReasoning });
          } else if (evt.type === "done") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: accContent, reasoning: accReasoning || null },
            ]);
            setLive(null);
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
    <div className="flex h-full min-w-0">
      {/* 会话列表 */}
      <div className="hidden w-56 shrink-0 flex-col border-r border-borderline bg-surface/50 md:flex">
        <div className="p-3">
          <button
            onClick={newChat}
            disabled={busy}
            className="w-full rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent transition hover:bg-accent hover:text-background disabled:opacity-40"
          >
            ＋ 新对话
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => openSession(s.id)}
              className={`block w-full truncate rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                s.id === sessionId
                  ? "bg-surface-2 text-foreground"
                  : "text-muted hover:bg-surface-2/60 hover:text-foreground"
              }`}
              title={s.title}
            >
              {s.title}
            </button>
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
                <h1 className="text-2xl font-semibold tracking-tight">
                  今天在想什么？
                </h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
                  说模糊的念头也行，说不完整的情绪也行。
                  这里不是搜索引擎——我会记住你，对照你的过去，也会在需要的时候反驳你。
                </p>
              </div>
            )}

            <div className="space-y-5">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-2 px-4 py-2.5 text-[14px] leading-relaxed">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <AssistantBubble
                    key={i}
                    content={m.content}
                    reasoning={m.reasoning ?? null}
                  />
                ),
              )}
              {live && (
                <AssistantBubble content={live.content} reasoning={live.reasoning} streaming />
              )}
            </div>
            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-borderline bg-surface/60 p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={Math.min(5, Math.max(1, input.split("\n").length))}
              placeholder="把此刻的想法丢进来……（Enter 发送，Shift+Enter 换行）"
              className="max-h-36 min-h-[44px] flex-1 resize-none rounded-lg border border-borderline bg-background px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted/60 focus:border-accent/50"
              disabled={busy}
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
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
    </div>
  );
}

function AssistantBubble({
  content,
  reasoning,
  streaming,
}: {
  content: string;
  reasoning: string | null;
  streaming?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 h-7 w-7 shrink-0 rounded-full border border-accent/50 bg-accent-soft pt-0.5 text-center text-sm leading-none text-accent">
        ◇
      </div>
      <div className="min-w-0 max-w-[90%]">
        {reasoning && (
          <details className="mb-2 group">
            <summary className="cursor-pointer select-none text-xs text-muted transition-colors hover:text-accent">
              思考过程 {streaming ? "…" : ""}
            </summary>
            <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-borderline/60 bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
              {reasoning}
            </div>
          </details>
        )}
        <div
          className={`whitespace-pre-wrap text-[14.5px] leading-[1.75] ${
            streaming && !content ? "text-muted" : ""
          }`}
        >
          {content || (streaming ? "…" : "")}
        </div>
      </div>
    </div>
  );
}
