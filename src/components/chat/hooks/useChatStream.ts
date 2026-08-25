"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchPanelStep, RetrievalTrace } from "@/lib/agent/chat-events";
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
  const [expandedThoughtMap, setExpandedThoughtMap] = useState<Record<number, boolean>>({});

  // 打字机缓冲引擎 Refs：负责在流式与断点重连时平滑输出字符
  const activeAssistantIndexRef = useRef<number | null>(null);
  const targetContentRef = useRef<string>("");
  const displayedContentRef = useRef<string>("");
  const targetReasoningRef = useRef<string>("");
  const displayedReasoningRef = useRef<string>("");
  const targetWebSourcesRef = useRef<WebSourceLite[] | undefined>(undefined);
  const targetRetrievedMemoriesRef = useRef<RetrievedMemory[] | undefined>(undefined);
  const targetRetrievedThemesRef = useRef<string[] | undefined>(undefined);
  const targetToolTracesRef = useRef<RetrievalTrace[] | undefined>(undefined);
  const targetDeepThinkingRef = useRef<boolean | undefined>(undefined);
  const targetDeepResearchRef = useRef<boolean | undefined>(undefined);
  const targetResearchStepsRef = useRef<ResearchPanelStep[]>([]);
  const isStreamDoneReceivedRef = useRef<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const reasoningStartTimeRef = useRef<number | null>(null);
  const reasoningEndTimeRef = useRef<number | null>(null);
  // 消息槽位 → DB id（流式新消息没有本地 id，靠 meta 事件的 userMessageId 登记）
  const messageIndexToIdRef = useRef<Map<number, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 打字机缓冲引擎：每 25ms 运行一次，将 targetContent 与 targetReasoning 平滑输出到 messages state
  useEffect(() => {
    const interval = setInterval(() => {
      const assistantIdx = activeAssistantIndexRef.current;
      if (assistantIdx === null) return;

      const targetC = targetContentRef.current;
      const displayedC = displayedContentRef.current;
      const targetR = targetReasoningRef.current;
      const displayedR = displayedReasoningRef.current;

      // 实时计算思考耗时
      const reasoningStart = reasoningStartTimeRef.current;
      const currentReasoningDuration =
        reasoningStart !== null
          ? ((reasoningEndTimeRef.current ?? Date.now()) - reasoningStart) / 1000
          : undefined;

      let hasContentChange = false;
      let nextContent = displayedC;
      if (displayedC.length < targetC.length) {
        const lag = targetC.length - displayedC.length;
        const step = lag > 80 ? 6 : lag > 25 ? 3 : 1;
        nextContent = targetC.slice(0, displayedC.length + step);
        displayedContentRef.current = nextContent;
        hasContentChange = true;
      }

      let hasReasoningChange = false;
      let nextReasoning = displayedR;
      if (displayedR.length < targetR.length) {
        const lag = targetR.length - displayedR.length;
        const step = lag > 120 ? 12 : lag > 40 ? 6 : 2;
        nextReasoning = targetR.slice(0, displayedR.length + step);
        displayedReasoningRef.current = nextReasoning;
        hasReasoningChange = true;
      }

      setMessages((prev) => {
        if (!prev[assistantIdx]) return prev;
        const currentMsg = prev[assistantIdx];

        const needsUpdate =
          hasContentChange ||
          hasReasoningChange ||
          currentMsg.reasoning_duration !== currentReasoningDuration ||
          currentMsg.toolTraces !== targetToolTracesRef.current ||
          currentMsg.retrievedMemories !== targetRetrievedMemoriesRef.current ||
          currentMsg.webSources !== targetWebSourcesRef.current ||
          currentMsg.deepThinking !== targetDeepThinkingRef.current ||
          currentMsg.deepResearch !== targetDeepResearchRef.current ||
          currentMsg.researchSteps !== targetResearchStepsRef.current;

        if (!needsUpdate) return prev;

        const updated = [...prev];
        updated[assistantIdx] = {
          ...currentMsg,
          content: nextContent,
          reasoning_content: nextReasoning || targetR || currentMsg.reasoning_content,
          reasoning_duration: currentReasoningDuration ?? currentMsg.reasoning_duration,
          webSources: targetWebSourcesRef.current ?? currentMsg.webSources,
          retrievedMemories: targetRetrievedMemoriesRef.current ?? currentMsg.retrievedMemories,
          retrievedThemes: targetRetrievedThemesRef.current ?? currentMsg.retrievedThemes,
          toolTraces: targetToolTracesRef.current ?? currentMsg.toolTraces,
          deepThinking: targetDeepThinkingRef.current ?? currentMsg.deepThinking,
          deepResearch: targetDeepResearchRef.current ?? currentMsg.deepResearch,
          researchSteps:
            targetResearchStepsRef.current.length > 0
              ? targetResearchStepsRef.current
              : undefined,
        };
        return updated;
      });

      // 仅在用户未主动向上滑动查看历史时，跟随滚到底部
      if ((hasContentChange || hasReasoningChange) && !scroll.userScrolledUpRef.current && scroll.scrollContainerRef.current) {
        scroll.scrollContainerRef.current.scrollTop = scroll.scrollContainerRef.current.scrollHeight;
      }

      if (
        isStreamDoneReceivedRef.current &&
        displayedContentRef.current.length >= targetContentRef.current.length &&
        displayedReasoningRef.current.length >= targetReasoningRef.current.length
      ) {
        setStreaming(false);
        setStreamingStatus("");
        activeAssistantIndexRef.current = null;
        isStreamDoneReceivedRef.current = false;
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
                targetDeepResearchRef.current = data.deepResearch === true;
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
                setStreamingStatus(
                  targetDeepResearchRef.current
                    ? "正在深度研究查证与推演..."
                    : targetDeepThinkingRef.current
                      ? "正在深度思考与推演..."
                      : "正在思考与对照...",
                );
                setExpandedThoughtMap((prev) => ({ ...prev, [assistantMsgIndex]: true }));
              } else if (data.type === "content") {
                if (reasoningStartTimeRef.current !== null && reasoningEndTimeRef.current === null) {
                  reasoningEndTimeRef.current = Date.now();
                }
                targetContentRef.current += data.text;
                setStreamingStatus("");
              } else if (data.type === "web") {
                targetWebSourcesRef.current = Array.isArray(data.sources) ? data.sources : [];
              } else if (data.type === "research") {
                targetResearchStepsRef.current = [
                  ...targetResearchStepsRef.current,
                  data.step,
                ];
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
      displayedReasoningRef.current = "";
      targetReasoningRef.current = "";
      targetWebSourcesRef.current = undefined;
      targetRetrievedMemoriesRef.current = undefined;
      targetRetrievedThemesRef.current = undefined;
      targetToolTracesRef.current = undefined;
      targetDeepThinkingRef.current = undefined;
      targetDeepResearchRef.current = undefined;
      targetResearchStepsRef.current = [];
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

      // 前置探查与思考卡片在流式生成中默认展开让用户实时看到查证与思维链
      setExpandedThoughtMap((prev) => ({ ...prev, [assistantMsgIndex]: true }));

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
    displayedReasoningRef.current = "";
    targetReasoningRef.current = "";
    targetWebSourcesRef.current = undefined;
    targetRetrievedMemoriesRef.current = undefined;
    targetRetrievedThemesRef.current = undefined;
    targetToolTracesRef.current = undefined;
    targetDeepThinkingRef.current = undefined;
    targetDeepResearchRef.current = undefined;
    targetResearchStepsRef.current = [];
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

        // 目标索引必须同步算出：函数式 setMessages 的 updater 会被 React 推迟到渲染期执行，
      // 若在 updater 里写索引，重连瞬间同步读到的仍是 -1 → targetIdx 退化为 0，打字机锁死到首条消息。
      const baseMsgs = initialMessages ?? [];
      let targetIdx = baseMsgs.length - 1;
      if (targetIdx < 0 || baseMsgs[targetIdx].role !== "assistant") {
        targetIdx = baseMsgs.length; // 最后一条不是助手消息：补一条空草稿再接管
        setMessages((prev) => {
          const msgs = initialMessages ?? prev;
          return [
            ...msgs,
            { role: "assistant", content: "", created_at: new Date().toISOString() },
          ];
        });
      } else {
        setMessages((prev) => (prev === baseMsgs ? prev : baseMsgs));
      }

      const existingContent = initialMessages?.[targetIdx]?.content || "";
      const existingReasoning = initialMessages?.[targetIdx]?.reasoning_content || "";
        // 展示基线保留已持久化的内容，但打字机目标从空白开始重放本次 SSE 全量事件
        displayedContentRef.current = existingContent;
        displayedReasoningRef.current = existingReasoning;
        targetContentRef.current = "";
        targetReasoningRef.current = "";
        targetDeepThinkingRef.current = undefined;
        targetDeepResearchRef.current = undefined;
        targetResearchStepsRef.current = [];
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

  const toggleThought = useCallback((msgIndex: number) => {
    setExpandedThoughtMap((prev) => ({
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
    expandedThoughtMap,
    toggleThought,
    consumeSseReader,
    reconnectStream,
    beginStream,
    endStream,
    resetStream,
    getMessageId,
    registerMessageId,
  };
}