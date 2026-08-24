"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assertOk } from "@/lib/utils";
import type { Candidate, Message, Session } from "../types";
import type { useChatScroll } from "./useChatScroll";
import type { useChatStream } from "./useChatStream";

interface UseChatSessionOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  stream: ReturnType<typeof useChatStream>;
  scroll: ReturnType<typeof useChatScroll>;
  showToast: (text: string, type?: "success" | "error") => void;
}

/**
 * 会话域状态：会话列表、当前会话、候选记忆、重命名/删除与切换竞态守卫。
 * 不持有消息正文与流式态——它们分别由 useChatStream / 页面 setMessages 拥有。
 */
export function useChatSession({
  setMessages,
  stream,
  scroll,
  showToast,
}: UseChatSessionOptions) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [consolidating, setConsolidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);

  // 会话切换请求序号：只采纳最新一次切换的响应，旧的先到也不再覆盖（防 A→B 竞态）
  const sessionRequestRef = useRef(0);
  const latestSessionRef = useRef<string | null>(null);
  useEffect(() => {
    latestSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  const loadCandidates = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setCandidates([]);
      return;
    }
    try {
      const res = await fetch(`/api/candidates?sessionId=${sessionId}`);
      const data = (await res.json()) as { candidates: Candidate[] };
      // 会话守卫：响应返回时若已切走会话，丢弃，避免把旧会话候选贴到新会话
      if (latestSessionRef.current === sessionId) setCandidates(data.candidates ?? []);
    } catch {
      if (latestSessionRef.current === sessionId) setCandidates([]);
    }
  }, []);

  /** 打开一个会话：加载消息与候选（自增序号守卫只采纳最新一次切换）。 */
  const openSession = useCallback(
    async (id: string) => {
      const requestId = ++sessionRequestRef.current;
      stream.resetStream();
      scroll.resetScroll();
      setCurrentSessionId(id);

      try {
        const res = await fetch(`/api/sessions/${id}`);
        const data = (await res.json()) as { messages: Message[]; isStreaming?: boolean };
        if (sessionRequestRef.current !== requestId) return;
        const msgList = data.messages ?? [];
        setMessages(msgList);
        // 如果后端当前还在后台生成中，立即无缝断点重连！
        if (data.isStreaming) stream.reconnectStream(id, msgList);
      } catch {
        if (sessionRequestRef.current === requestId) setMessages([]);
      }

      try {
        const res = await fetch(`/api/candidates?sessionId=${id}`);
        const data = (await res.json()) as { candidates: Candidate[] };
        if (sessionRequestRef.current === requestId) setCandidates(data.candidates ?? []);
      } catch {
        if (sessionRequestRef.current === requestId) setCandidates([]);
      }

      setTimeout(() => scroll.scrollToBottom(false), 50);
    },
    [stream, scroll, setMessages],
  );

  const createSession = useCallback(
    async (initialTitle?: string) => {
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: initialTitle || "新对话" }),
        });
        const data = (await res.json()) as { session: Session };
        if (data.session) {
          setSessions((prev) => [data.session, ...prev]);
          setCurrentSessionId(data.session.id);
          setMessages([]);
          setCandidates([]);
          stream.resetStream();
          return data.session.id;
        }
      } catch {
        showToast("创建对话失败", "error");
      }
      return null;
    },
    [setMessages, showToast, stream],
  );

  /** 开启新思考：清空当前界面，进入全新草稿态（发送首条消息时自动建会话）。 */
  const startNewChat = useCallback(() => {
    stream.resetStream();
    scroll.resetScroll();
    setCurrentSessionId(null);
    setMessages([]);
    setCandidates([]);
  }, [stream, scroll, setMessages]);

  /** SSE meta 事件自动为新会话起名：回填会话列表。 */
  const updateTitle = useCallback((sessionId: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
  }, []);

  /** 一轮流式结束（含断点重连）：拉候选。背景整理在 done 之后异步落 staging，
   * 立即拉通常查不到，延迟补拉一次并带会话守卫。 */
  const onStreamEnd = useCallback(
    (sessionId: string) => {
      loadCandidates(sessionId);
      const streamSessionId = sessionId;
      setTimeout(() => {
        if (latestSessionRef.current === streamSessionId) loadCandidates(streamSessionId);
      }, 1800);
    },
    [loadCandidates],
  );

  const submitRename = useCallback(async () => {
    if (!renameTarget || !renameTitle.trim()) return;
    try {
      const res = await fetch(`/api/sessions/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renameTitle.trim() }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === renameTarget.id ? { ...s, title: renameTitle.trim() } : s)),
        );
        showToast("重命名成功");
      }
    } catch {
      showToast("重命名失败", "error");
    } finally {
      setRenameTarget(null);
      setRenameTitle("");
    }
  }, [renameTarget, renameTitle, showToast]);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/sessions/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const remaining = sessions.filter((s) => s.id !== deleteTarget.id);
        setSessions(remaining);
        if (currentSessionId === deleteTarget.id) {
          if (remaining.length > 0) {
            openSession(remaining[0].id);
          } else {
            setCurrentSessionId(null);
            setMessages([]);
          }
        }
        showToast("对话已删除");
      }
    } catch {
      showToast("删除失败", "error");
    } finally {
      setDeleteTarget(null);
    }
  }, [sessions, currentSessionId, deleteTarget, openSession, setMessages, showToast]);

  /** 手动触发一次整理（自动整理每轮已跑过），然后刷新候选列表。 */
  const triggerConsolidate = useCallback(async () => {
    if (!currentSessionId || consolidating) return;
    setConsolidating(true);
    try {
      await assertOk(
        await fetch("/api/consolidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSessionId }),
        }),
      );
      await loadCandidates(currentSessionId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "整理记忆失败", "error");
    } finally {
      setConsolidating(false);
    }
  }, [currentSessionId, consolidating, loadCandidates, showToast]);

  /** 确认/拒绝记忆候选：确认才真正入库（+标签+关联边+向量化）。 */
  const decideCandidate = useCallback(
    async (id: number, decision: "approve" | "reject") => {
      try {
        await assertOk(
          await fetch(`/api/candidates/${id}/decide`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          }),
        );
        setCandidates((prev) => prev.filter((c) => c.id !== id));
        if (decision === "approve") showToast("已确认为长期记忆");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "操作失败", "error");
      }
    },
    [showToast],
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId),
    [sessions, currentSessionId],
  );

  return {
    sessions,
    setSessions,
    currentSessionId,
    searchQuery,
    setSearchQuery,
    filteredSessions,
    currentSession,
    renameTarget,
    renameTitle,
    deleteTarget,
    setRenameTitle,
    setRenameTarget,
    setDeleteTarget,
    openSession,
    createSession,
    startNewChat,
    updateTitle,
    onStreamEnd,
    submitRename,
    submitDelete,
    candidates,
    setCandidates,
    triggerConsolidate,
    decideCandidate,
    consolidating,
  };
}