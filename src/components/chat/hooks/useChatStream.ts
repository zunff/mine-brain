"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RetrievalTrace } from "@/lib/agent/chat-events";
import type { Message, RetrievedMemory, WebSourceLite } from "../types";

export interface UseChatStreamHooks {
  /** meta 事件携带了后端生成的会话标题（每轮首个消息后自动起名） */
  onMeta?: (sessionId: string, title: string) => void;
  /** 一轮流式结束（含断点重连收尾），用于拉取该会话的候选记忆 */
  onDone?: (sessionId: string) => void;
}

/**
 * 聊天流的全部动态面：SSE 消费、打字机缓冲、断点重连、思考/上下文折叠态。
 * 只持有「正在发生什么」，不持有会话列表与消息正文的持久状态（消息由上层 setMessages 驱动）。
 * hooks 经调用方持有的 ref 注入：会话层晚于流层创建，事件是异步的，读 ref 不会撞上初始化顺序。
 */
export function useChatStream(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  scroll: {
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    userScrolledUpRef: React.MutableRefObject<boolean>;
  },
  hooksRef: React.RefObject<UseChatStreamHooks>,
) {
  const [streaming, setStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState("");
  const [streamingElapsed, setStreamingElapsed] = useState(0);
  const [expandedReasoningMap, setExpandedReasoningMap] = useState<Record<number, boolean>>({});
  const [expandedContextMap, setExpandedContextMap] = useState<Record<number, boolean>>({});

  // 打字机缓冲引擎 Refs：负责在流式与断点重连时平滑输出字符
  const activeAssistantIndexRef = useRef<number | null>(null);
  const targetContentRef = useRef<string>("");
  const displayedContentRef = useRef<string>("");
  const targetReasoningRef = useRef<string>("");
  const targetWebSourcesRef = useRef<WebSourceLite[] | undefined>(undefined);
  const targetRetrievedMemoriesRef = useRef<RetrievedMemory[] | undefined>(undefined);
  const targetRetrievedThemesRef = useRef<string[] | undefined>(undefined);
  const targetToolTracesRef = useRef<RetrievalTrace[] | undefined>(undefined);
  const targetDeepThinkingRef = useRef<boolean | undefined>(undefined);
  const isStreamDoneReceivedRef = useRef<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const reasoningStartTimeRef = useRef<number | null>(null);
  const reasoningEndTimeRef = useRef<number | null>(null);
  // 消息槽位 → DB id（流式新消息没有本地 id，靠 meta 事件的 userMessageId 登记）
  const messageIndexToIdRef = useRef<Map<number, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 打字机缓冲引擎：每 25ms 运行一次，将 targetContentRef 平滑输出到 displayedContentRef
  useEffect(() => {
    const interval = setInterval(() => {
      const assistantIdx = activeAssistantIndexRef.current;
      if (assistantIdx === null) return;

      const target = targetContentRef.current;
      const displayed = displayedContentRef.current;

      // 实时计算思考耗时
      const reasoningStart = reasoningStartTimeRef.current;
      const currentReasoningDuration =
        reasoningStart !== null
          ? ((reasoningEndTimeRef.current ?? Date.now()) - reasoningStart) / 1000
          : undefined;

      if (displayed.length < target.length) {
        const lag = target.length - displayed.length;
        const step = lag > 80 ? 4 : lag > 25 ? 2 : 1;
        const next = target.slice(0, displayed.length + step);
        displayedContentRef.current = next;

        setMessages((prev) => {
          if (!prev[assistantIdx]) return prev;
          const updated = [...prev];
          updated[assistantIdx] = {
            ...updated[assistantIdx],
            content: next,
            reasoning_content: targetReasoningRef.current || updated[assistantIdx].reasoning_content,
            reasoning_duration: currentReasoningDuration ?? updated[assistantIdx].reasoning_duration,
            webSources: targetWebSourcesRef.current ?? updated[assistantIdx].webSources,
            retrievedMemories: targetRetrievedMemoriesRef.current ?? updated[assistantIdx].retrievedMemories,
            retrievedThemes: targetRetrievedThemesRef.current ?? updated[assistantIdx].retrievedThemes,
            toolTraces: targetToolTracesRef.current ?? updated[assistantIdx].toolTraces,
            deepThinking: targetDeepThinkingRef.current ?? updated[assistantIdx].deepThinking,
          };
          return updated;
        });

        // 仅在用户未主动向上滑动查看历史时，跟随滚到底部
        if (!scroll.userScrolledUpRef.current && scroll.scrollContainerRef.current) {
          scroll.scrollContainerRef.current.scrollTop = scroll.scrollContainerRef.current.scrollHeight;
        }
      } else {
        if (isStreamDoneReceivedRef.current) {
          setStreaming(false);
          setStreamingStatus("");
          activeAssistantIndexRef.current = null;
          isStreamDoneReceivedRef.current = false;
        }
      }
    }, 25);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consumeSseReader = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      activeSessionId: string,
      assistantMsgIndex: number,
    ) => {
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const data = JSON.parse(jsonStr);
              if (data.type === "status") {
                setStreamingStatus(data.text);
              } else if (data.type === "trace") {
                const incomingTrace = data.trace;
                targetToolTracesRef.current = [
                  ...(targetToolTracesRef.current ?? []).filter((t) => t.id !== incomingTrace.id),
                  incomingTrace,
                ];
              } else if (data.type === "context") {
                targetDeepThinkingRef.current = data.deepThinking === true;
                targetRetrievedThemesRef.current = Array.isArray(data.themes) ? data.themes : [];
                targetRetrievedMemoriesRef.current = Array.isArray(data.memories) ? data.memories : [];
                if (Array.isArray(data.traces)) {
                  targetToolTracesRef.current = data.traces;
                }
              } else if (data.type === "reasoning") {
                if (reasoningStartTimeRef.current === null) {
                  reasoningStartTimeRef.current = Date.now();
                }
                targetReasoningRef.current += data.text;
                setStreamingStatus("正在深度思考与对照...");
                setExpandedReasoningMap((prev) => ({ ...prev, [assistantMsgIndex]: true }));
              } else if (data.type === "content") {
                if (reasoningStartTimeRef.current !== null && reasoningEndTimeRef.current === null) {
                  reasoningEndTimeRef.current = Date.now();
                }
                targetContentRef.current += data.text;
                setStreamingStatus("");
              } else if (data.type === "web") {
                targetWebSourcesRef.current = Array.isArray(data.sources) ? data.sources : [];
              } else if (data.type === "meta") {
                if (data.title && data.title !== "新对话") {
                  hooksRef.current?.onMeta?.(activeSessionId, data.title);
                }
                if (typeof data.userMessageId === "number") {
                  messageIndexToIdRef.current.set(assistantMsgIndex - 1, data.userMessageId);
                }
              } else if (data.type === "done") {
                isStreamDoneReceivedRef.current = true;
              }
            } catch {
              // ignore JSON parse errors on malformed chunks
            }
          }
        }
      } finally {
        isStreamDoneReceivedRef.current = true;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (activeSessionId) {
          hooksRef.current?.onDone?.(activeSessionId);
        }
      }
    },
    [hooksRef],
  );

  /** 发送前重置全部流式缓冲并启动一轮新流，返回供 fetch 使用的 AbortController。 */
  const beginStream = useCallback(
    (assistantMsgIndex: number, initialStatus: string): AbortController => {
      displayedContentRef.current = "";
      targetContentRef.current = "";
      targetReasoningRef.current = "";
      targetWebSourcesRef.current = undefined;
      targetRetrievedMemoriesRef.current = undefined;
      targetRetrievedThemesRef.current = undefined;
      targetToolTracesRef.current = undefined;
      targetDeepThinkingRef.current = undefined;
      activeAssistantIndexRef.current = assistantMsgIndex;
      isStreamDoneReceivedRef.current = false;
      reasoningStartTimeRef.current = null;
      reasoningEndTimeRef.current = null;

      setStreaming(true);
      setStreamingStatus(initialStatus);
      setStreamingElapsed(0);

      // 思考耗时计时器
      const startTime = Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setStreamingElapsed((Date.now() - startTime) / 1000);
      }, 100);

      // 思考卡片在流式生成中默认展开
      setExpandedReasoningMap((prev) => ({ ...prev, [assistantMsgIndex]: true }));

      // 中断可能存在的旧连接
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;
      return abortController;
    },
    [],
  );

  /** 一轮结束：停止流式态并清空打字机槽位（409/失败回滚后调用）。 */
  const endStream = useCallback(() => {
    setStreaming(false);
    setStreamingStatus("");
    activeAssistantIndexRef.current = null;
    isStreamDoneReceivedRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 会话切换 / 开启新思考：中断旧连接并清空流式缓冲。 */
  const resetStream = useCallback(() => {
    setStreaming(false);
    setStreamingStatus("");
    activeAssistantIndexRef.current = null;
    isStreamDoneReceivedRef.current = false;
    displayedContentRef.current = "";
    targetContentRef.current = "";
    targetReasoningRef.current = "";
    targetWebSourcesRef.current = undefined;
    targetRetrievedMemoriesRef.current = undefined;
    targetRetrievedThemesRef.current = undefined;
    targetToolTracesRef.current = undefined;
    targetDeepThinkingRef.current = undefined;
    messageIndexToIdRef.current.clear();
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
  }, []);

  /** 断点重连：重新连入正在后台生成的任务并启动打字机追赶 */
  const reconnectStream = useCallback(
    async (sessionId: string, initialMessages?: Message[]) => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      try {
        const res = await fetch(`/api/chat?sessionId=${sessionId}`, {
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) return;

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("text/event-stream")) {
          return;
        }

        let assistantIdx = -1;
        setMessages((prev) => {
          const msgs = initialMessages ?? prev;
          assistantIdx = msgs.length - 1;
          if (assistantIdx < 0 || msgs[assistantIdx].role !== "assistant") {
            const newDraft: Message = {
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
            };
            assistantIdx = msgs.length;
            return [...msgs, newDraft];
          }
          return msgs;
        });

        const targetIdx = assistantIdx >= 0 ? assistantIdx : 0;
        const existingContent = initialMessages?.[targetIdx]?.content || "";
        // 展示基线保留已持久化的内容，但打字机目标从空白开始重放本次 SSE 全量事件
        displayedContentRef.current = existingContent;
        targetContentRef.current = "";
        targetReasoningRef.current = "";
        targetDeepThinkingRef.current = undefined;
        targetWebSourcesRef.current = undefined;
        targetRetrievedMemoriesRef.current = undefined;
        targetRetrievedThemesRef.current = undefined;
        targetToolTracesRef.current = undefined;
        activeAssistantIndexRef.current = targetIdx;
        isStreamDoneReceivedRef.current = false;
        setStreaming(true);
        setStreamingStatus("正在恢复思考内容...");

        const reader = res.body.getReader();
        await consumeSseReader(reader, sessionId, targetIdx);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
      }
    },
    [consumeSseReader, setMessages],
  );

  const toggleReasoning = useCallback((msgIndex: number) => {
    setExpandedReasoningMap((prev) => ({
      ...prev,
      [msgIndex]: !prev[msgIndex],
    }));
  }, []);

  const toggleContext = useCallback((msgIndex: number) => {
    setExpandedContextMap((prev) => ({
      ...prev,
      [msgIndex]: !prev[msgIndex],
    }));
  }, []);

  // 消息槽位 → DB id 的读写入口（内部 ref 不对外暴露，避免 react-hooks/immutability）
  const getMessageId = useCallback((index: number) => {
    return messageIndexToIdRef.current.get(index);
  }, []);
  const registerMessageId = useCallback((index: number, id: number) => {
    messageIndexToIdRef.current.set(index, id);
  }, []);

  return {
    streaming,
    streamingStatus,
    streamingElapsed,
    expandedReasoningMap,
    expandedContextMap,
    toggleReasoning,
    toggleContext,
    consumeSseReader,
    reconnectStream,
    beginStream,
    endStream,
    resetStream,
    getMessageId,
    registerMessageId,
  };
}