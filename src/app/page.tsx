"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import ChatMessage from "@/components/chat/ChatMessage";
import Composer from "@/components/chat/Composer";
import Sidebar from "@/components/chat/Sidebar";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatEmptyState from "@/components/chat/ChatEmptyState";
import CandidatePanel from "@/components/chat/CandidatePanel";
import SessionDialogs from "@/components/chat/SessionDialogs";
import PairDeleteDialog from "@/components/chat/PairDeleteDialog";
import { useChatScroll } from "@/components/chat/hooks/useChatScroll";
import { useChatComposer } from "@/components/chat/hooks/useChatComposer";
import {
  useChatStream,
  type UseChatStreamHooks,
} from "@/components/chat/hooks/useChatStream";
import { useChatSession } from "@/components/chat/hooks/useChatSession";
import { type Message, type Session } from "@/components/chat/types";

export default function ChatPage() {
  // 消息正文是页面所有编排的落点，保留在最上层
  const [messages, setMessages] = useState<Message[]>([]);

  // Toast
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 预设 hook：滚动 / 流式 / 输入 / 会话各管一个状态域
  const scroll = useChatScroll();
  const streamHooksRef = useRef<UseChatStreamHooks>({});
  const stream = useChatStream(setMessages, scroll, streamHooksRef);
  const composer = useChatComposer(() => showToast("图片处理失败", "error"));
  const session = useChatSession({ setMessages, stream, scroll, showToast });
  // 流式收尾/起名回调经 ref 注入（事件异步发生；ref 写入放在 effect，避免渲染期改写 ref）
  useEffect(() => {
    streamHooksRef.current = {
      onMeta: session.updateTitle,
      onDone: session.onStreamEnd,
    };
  });
  const { scrollContainerRef, showScrollBottomBtn, handleScroll, scrollToBottom, resetScroll } =
    scroll;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // 深度思考开关：激活多维度认知探针与长程推理（localStorage 记住偏好）
  const [deepThinkingOn, setDeepThinkingOn] = useState(false);
  // 深度研究开关：成文前多角度拆解、逐子问题查证记忆与外部资料、对照反例（localStorage 记住偏好）
  const [deepResearchOn, setDeepResearchOn] = useState(false);
  // 联网开关：配置了搜索 key 才出现；记住上次的选择（localStorage 只存偏好）
  const [webOn, setWebOn] = useState(false);
  const [webAvailable, setWebAvailable] = useState(false);

  // Copy state
  const [copiedId, setCopiedId] = useState<number | string | null>(null);

  // 删除某一轮问答：确认框保存预览，确认后硬删并以重载对齐后续索引
  const [pendingPairDelete, setPendingPairDelete] = useState<{
    userIdx: number;
    assistantIdx: number;
    question: string;
    answer: string;
  } | null>(null);
  const [pairDeleting, setPairDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      // 本地偏好读取放进微任务：避免在 effect 体内同步 setState 触发级联渲染
      await Promise.resolve();
      try {
        const savedWeb = localStorage.getItem("mine-brain.web") === "1";
        if (active) setWebOn(savedWeb);
      } catch {
        /* 存储不可用时保持默认关 */
      }
      try {
        const savedDeep = localStorage.getItem("mine-brain.deep") === "1";
        if (active) setDeepThinkingOn(savedDeep);
      } catch {
        /* ignore */
      }
      try {
        const savedResearch = localStorage.getItem("mine-brain.research") === "1";
        if (active) setDeepResearchOn(savedResearch);
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/settings");
        const d = (await res.json()) as { searcher?: { ready?: boolean } | null };
        if (active) setWebAvailable(Boolean(d.searcher?.ready));
      } catch {
        /* 拉不到配置就隐藏开关（与 embedder 未配置即隐藏同一纪律） */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleWeb = () => {
    setWebOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("mine-brain.web", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleDeepThinking = () => {
    setDeepThinkingOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("mine-brain.deep", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleDeepResearch = () => {
    setDeepResearchOn((v) => {
      const next = !v;
      try {
        localStorage.setItem("mine-brain.research", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 首次运行引导：未建立画像且未显式跳过时，去 /onboarding 让他决定，而不是默默开聊
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        const d = (await res.json()) as {
          hasProfile?: boolean;
          onboarding?: { status?: string };
        };
        if (!active) return;
        if (!d.hasProfile && d.onboarding?.status === "not_started") {
          router.push("/onboarding");
        }
      } catch {
        /* 网络/接口异常时保持可用 */
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // 仅在组件初次挂载时初始化会话列表并打开最近会话（严禁依赖会变动的闭包，避免循环重置）
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = (await res.json()) as { sessions: Session[] };
        const list = data.sessions ?? [];
        if (!active) return;
        session.setSessions(list);
        if (list.length > 0) {
          session.openSession(list[0].id);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyToClipboard = (text: string, id: number | string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast("已复制到剪贴板");
    setTimeout(() => setCopiedId(null), 2000);
  };

  /** 编辑旧消息：回填输入框并进入「截断重发」态（发送后旧一问一答被替换）。 */
  const handleEditMessage = (msgIndex: number) => {
    const m = messages[msgIndex];
    if (!m || m.role !== "user") return;
    // 记录该槽位的 DB id（流式新消息没有本地 id，靠 meta 事件的 userMessageId 登记过）
    const messageId = m.id ?? stream.getMessageId(msgIndex);
    if (messageId != null && messageId > 0) {
      stream.registerMessageId(msgIndex, messageId);
    }
    composer.startEdit(msgIndex, m.content, m.images);
    resetScroll();
  };

  const send = async (
    overrideText?: string,
    overrideImages?: string[],
    mode?: { replaceAtIndex?: number },
  ) => {
    const textToSend = overrideText ?? composer.input;
    const imgsToSend = overrideImages ?? composer.images;
    if ((!textToSend.trim() && imgsToSend.length === 0) || stream.streaming) return;

    // 替换模式：编辑（replaceAtIndex=旧用户消息槽位）与重新生成可共用一条路径。
    // 发送前快照，失败时可整帧回滚，而不是依赖截断来补偿。
    const prevMessages = messages;
    const replaceAtIndex = mode?.replaceAtIndex ?? composer.editingIndex;
    const userMsgIndex = replaceAtIndex != null ? replaceAtIndex : messages.length;
    const replacedUserMsg =
      userMsgIndex >= 0 && userMsgIndex < messages.length ? messages[userMsgIndex] : undefined;
    // DB id 优先；流式新消息没有本地 id 时用 meta 事件登记的 map
    const replaceMessageId = replacedUserMsg?.id ?? stream.getMessageId(userMsgIndex);

    if (replaceAtIndex != null) {
      // 本地先截断旧问答（服务端在 stream-manager 排除冲突后才真正截断）
      setMessages((prev) => prev.slice(0, replaceAtIndex));
    }
    composer.setEditingIndex(null);

    let activeSessionId = session.currentSessionId;
    if (!activeSessionId) {
      const firstLine = textToSend.trim().slice(0, 20) || "新对话";
      activeSessionId = await session.createSession(firstLine);
      if (!activeSessionId) return;
    }

    const userMsg: Message = {
      role: "user",
      content: textToSend.trim(),
      images: imgsToSend.length > 0 ? imgsToSend : undefined,
      created_at: new Date().toISOString(),
    };

    const assistantMsgIndex = userMsgIndex + 1;
    const initialAssistantMsg: Message = {
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    composer.clearComposer();
    resetScroll();
    setTimeout(() => scrollToBottom(false), 50);

    // 重置打字机缓冲、启动计时并建立本轮 AbortController
    const abortController = stream.beginStream(assistantMsgIndex, "正在调取历史记忆与价值观...");

    let rolledBack = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: userMsg.content,
          images: userMsg.images,
          webSearch: webOn,
          deepThinking: deepThinkingOn,
          deepResearch: deepResearchOn,
          ...(replaceMessageId != null ? { replaceFromMessageId: replaceMessageId } : {}),
        }),
      });

      if (!res.ok) {
        if (res.status === 409) {
          rolledBack = true;
          setMessages(prevMessages);
          composer.setInput(textToSend);
          composer.setImages(imgsToSend);
          showToast("该会话正在另一处生成回复，请稍候再试", "error");
          stream.endStream();
          return;
        }
        const errorData = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("无响应数据流");

      const reader = res.body.getReader();
      await stream.consumeSseReader(reader, activeSessionId, assistantMsgIndex);

      // Update session title if it's the first message and still named "新对话"
      const currSession = session.sessions.find((s) => s.id === activeSessionId);
      if (currSession && (currSession.title === "新对话" || !currSession.title)) {
        const newTitle = userMsg.content.slice(0, 16) || "新对话";
        fetch(`/api/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        }).then(() => {
          session.setSessions((prev) =>
            prev.map((s) => (s.id === activeSessionId ? { ...s, title: newTitle } : s))
          );
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : "连接失败";
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantMsgIndex] = {
          role: "assistant",
          content: `⚠️ 对话出错：${errorMsg}。\n\n请检查「设置」页中的 API Key 与 Base URL 是否正确。`,
          created_at: new Date().toISOString(),
        };
        return updated;
      });
      showToast("发送失败，请检查配置", "error");
      stream.endStream();
    } finally {
      if (activeSessionId && !rolledBack) {
        session.setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, message_count: (s.message_count ?? 0) + 2 } : s
          )
        );
      }
    }
  };

  /** 重新生成某一轮助手回复：以「替换旧用户消息」的同一路径重发（避免旧闭包里的 messages.length 指向错位槽位）。 */
  const regenerate = async (assistantIdx: number) => {
    if (stream.streaming) return;
    const userIdx = assistantIdx - 1;
    const prevUserMsg = messages[userIdx];
    if (!prevUserMsg || prevUserMsg.role !== "user") return;
    await send(prevUserMsg.content, prevUserMsg.images, { replaceAtIndex: userIdx });
  };

  /** 请求删除某一轮问答：锁定它的问题与回复预览，弹确认框。 */
  const handleRequestDeletePair = (assistantIdx: number) => {
    if (stream.streaming) return;
    const userIdx = assistantIdx - 1;
    const userMsg = messages[userIdx];
    if (!userMsg || userMsg.role !== "user") return;
    setPendingPairDelete({
      userIdx,
      assistantIdx,
      question: userMsg.content.slice(0, 200),
      answer: (messages[assistantIdx]?.content ?? "").slice(0, 200),
    });
  };

  /** 确认删除一问一答：DB 硬删后重载会话，避免后续编辑/重放因下标位移指向错消息。 */
  const handleConfirmDeletePair = async () => {
    const target = pendingPairDelete;
    if (!target || !session.currentSessionId) return;
    const userMsg = messages[target.userIdx];
    const userMessageId = userMsg?.id ?? stream.getMessageId(target.userIdx);
    if (userMessageId == null || userMessageId <= 0) {
      setPendingPairDelete(null);
      showToast("无法定位该轮消息，请刷新后重试", "error");
      return;
    }
    setPairDeleting(true);
    try {
      const res = await fetch(
        `/api/sessions/${session.currentSessionId}/messages/${userMessageId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? "该会话正在生成回复，请稍后再试"
            : res.status === 404
              ? "该轮消息不存在或已被删除"
              : "删除失败",
        );
      }
      const data = (await res.json().catch(() => ({ deleted: 2 }))) as { deleted?: number };
      setPendingPairDelete(null);
      showToast("已删除这一轮问答，不再进入后续对话");
      session.setSessions((prev) =>
        prev.map((s) =>
          s.id === session.currentSessionId
            ? { ...s, message_count: Math.max(0, (s.message_count ?? 0) - (data.deleted ?? 2)) }
            : s,
        ),
      );
      await session.openSession(session.currentSessionId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setPairDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const startNewChatWithFocus = () => {
    session.startNewChat();
    composer.textareaRef.current?.focus();
  };

  return (
    <div className="flex h-full w-full min-h-0 overflow-hidden bg-background">
      {/* Toast notification */}
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

      {/* Desktop Session Sidebar & Mobile Drawer */}
      <Sidebar
        sidebarOpen={sidebarOpen}
        mobileDrawerOpen={mobileDrawerOpen}
        sessions={session.sessions}
        filteredSessions={session.filteredSessions}
        currentSessionId={session.currentSessionId}
        searchQuery={session.searchQuery}
        onSetMobileDrawer={setMobileDrawerOpen}
        onSearchChange={session.setSearchQuery}
        onNewChat={startNewChatWithFocus}
        onSelectSession={(id) => {
          session.openSession(id);
          setMobileDrawerOpen(false);
        }}
        onOpenRename={(s) => {
          session.setRenameTarget(s);
          session.setRenameTitle(s.title);
        }}
        onOpenDelete={(s) => session.setDeleteTarget(s)}
        onOpenRenameMobile={(s) => {
          setMobileDrawerOpen(false);
          session.setRenameTarget(s);
          session.setRenameTitle(s.title);
        }}
        onOpenDeleteMobile={(s) => {
          setMobileDrawerOpen(false);
          session.setDeleteTarget(s);
        }}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-background relative">
        <ChatHeader
          title={session.currentSession?.title || "思考伙伴"}
          sessionCount={session.sessions.length}
          showConsolidate={messages.length > 1}
          consolidating={session.consolidating}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
          onConsolidate={session.triggerConsolidate}
          onNewChat={startNewChatWithFocus}
        />

        {/* Messages Stream Container */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 md:px-8 py-6 space-y-6 relative"
        >
          {messages.length === 0 ? (
            <ChatEmptyState onPrompt={(text) => send(text)} />
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg, idx) => {
                const isStreamingCurrent = stream.streaming && idx === messages.length - 1;

                return (
                  <ChatMessage
                    key={idx}
                    msg={msg}
                    idx={idx}
                    streaming={stream.streaming}
                    isStreamingCurrent={isStreamingCurrent}
                    streamingStatus={stream.streamingStatus}
                    streamingElapsed={stream.streamingElapsed}
                    expandedThought={stream.expandedThoughtMap[idx] ?? isStreamingCurrent}
                    isCopied={copiedId === idx}
                    isEditing={composer.editingIndex === idx}
                    isLast={idx === messages.length - 1}
                    canDeletePair={!stream.streaming && idx > 0 && messages[idx - 1]?.role === "user"}
                    onToggleThought={stream.toggleThought}
                    onCopy={(i) => copyToClipboard(messages[i].content, i)}
                    onRegenerate={regenerate}
                    onEdit={handleEditMessage}
                    onDeletePair={handleRequestDeletePair}
                  />
                );
              })}

              <CandidatePanel
                candidates={session.candidates}
                onApprove={(id) => session.decideCandidate(id, "approve")}
                onReject={(id) => session.decideCandidate(id, "reject")}
                onDismiss={() => session.setCandidates([])}
              />
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* 回到最新浮动按钮 */}
          {showScrollBottomBtn && (
            <div className="sticky bottom-2 flex justify-center z-20 pointer-events-none">
              <button
                onClick={() => scrollToBottom(true)}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-surface/95 backdrop-blur-md px-3.5 py-1.5 text-xs text-foreground shadow-md hover:bg-surface-hover hover:border-accent/40 transition-all animate-in fade-in slide-in-from-bottom-2 cursor-pointer"
              >
                <ArrowDown className="h-3.5 w-3.5 text-accent animate-bounce" />
                <span>回到最新</span>
              </button>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <Composer
          input={composer.input}
          images={composer.images}
          streaming={stream.streaming}
          webOn={webOn}
          deepThinkingOn={deepThinkingOn}
          deepResearchOn={deepResearchOn}
          webAvailable={webAvailable}
          inputRef={composer.textareaRef}
          fileRef={composer.fileInputRef}
          onInputChange={composer.changeInput}
          onKeyDown={handleKeyDown}
          onRemoveImage={composer.removeImage}
          onPickFile={composer.pickFile}
          onUpload={composer.handleImageUpload}
          onSend={() => send()}
          onToggleWeb={toggleWeb}
          onToggleDeep={toggleDeepThinking}
          onToggleResearch={toggleDeepResearch}
        />
      </main>

      <SessionDialogs
        renameTarget={session.renameTarget}
        renameTitle={session.renameTitle}
        deleteTarget={session.deleteTarget}
        onRenameChange={session.setRenameTitle}
        onRenameSubmit={session.submitRename}
        onRenameCancel={() => {
          session.setRenameTarget(null);
          session.setRenameTitle("");
        }}
        onDeleteSubmit={session.submitDelete}
        onDeleteCancel={() => session.setDeleteTarget(null)}
      />

      <PairDeleteDialog
        target={pendingPairDelete}
        deleting={pairDeleting}
        onConfirm={handleConfirmDeletePair}
        onCancel={() => setPendingPairDelete(null)}
      />
    </div>
  );
}