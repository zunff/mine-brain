"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MessageSquare,
  Plus,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Edit3,
  Image as ImageIcon,
  X,
  Brain,
  Search,
  Sparkles,
  Bot,
  User,
  PanelLeftClose,
  PanelLeft,
  ArrowUp,
  AlertCircle,
  Compass,
  HelpCircle,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { compressImageFile } from "@/lib/image-compress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Message {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string;
  images?: string[];
  created_at?: string;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

interface StagedCandidate {
  type: string;
  title: string;
  content: string;
  theme?: string;
  tags?: string[];
}

function parseMsgImages(images: unknown): string[] {
  if (!images) return [];
  if (Array.isArray(images)) {
    return images.filter((img): img is string => typeof img === "string" && img.length > 0);
  }
  if (typeof images === "string") {
    try {
      const parsed = JSON.parse(images);
      if (Array.isArray(parsed)) {
        return parsed.filter((img): img is string => typeof img === "string" && img.length > 0);
      }
      if (typeof parsed === "string" && parsed.length > 0) return [parsed];
    } catch {
      if (images.startsWith("data:") || images.startsWith("http")) return [images];
    }
  }
  return [];
}

const STARTER_PROMPTS = [
  {
    icon: Compass,
    title: "梳理重大决定",
    desc: "我在考虑换工作/搬家/开启新项目，想权衡利弊与长远影响",
  },
  {
    icon: Brain,
    title: "反思价值冲突",
    desc: "我感觉现在的节奏和我的核心价值观有冲突，帮我看看盲点",
  },
  {
    icon: AlertCircle,
    title: "走出内耗循环",
    desc: "我又陷入了反复纠结的思维模式中，需要跳出来客观审视",
  },
  {
    icon: HelpCircle,
    title: "对照历史想法",
    desc: "看看我过去的记录，我的想法在哪些地方悄悄发生了改变？",
  },
];

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [staged, setStaged] = useState<StagedCandidate[]>([]);
  const [consolidating, setConsolidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Dialog states for session operations
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);

  // Copy state
  const [copiedId, setCopiedId] = useState<number | string | null>(null);

  // Toast message
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = (await res.json()) as { sessions: Session[] };
      setSessions(data.sessions ?? []);
      return data.sessions ?? [];
    } catch {
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    }
  }, []);

  // Initialize
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = (await res.json()) as { sessions: Session[] };
        const list = data.sessions ?? [];
        if (!active) return;
        setSessions(list);
        if (list.length > 0) {
          setCurrentSessionId(list[0].id);
          const msgRes = await fetch(`/api/sessions/${list[0].id}`);
          const msgData = (await msgRes.json()) as { messages: Message[] };
          if (active) {
            setMessages(msgData.messages ?? []);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Scroll to bottom on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const selectSession = async (id: string) => {
    setCurrentSessionId(id);
    setMobileDrawerOpen(false);
    await loadMessages(id);
  };

  const createSession = async (initialTitle?: string) => {
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
        setMobileDrawerOpen(false);
        return data.session.id;
      }
    } catch {
      showToast("创建对话失败", "error");
    }
    return null;
  };

  const submitRename = async () => {
    if (!renameTarget || !renameTitle.trim()) return;
    try {
      const res = await fetch(`/api/sessions/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renameTitle.trim() }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === renameTarget.id ? { ...s, title: renameTitle.trim() } : s))
        );
        showToast("重命名成功");
      }
    } catch {
      showToast("重命名失败", "error");
    } finally {
      setRenameTarget(null);
      setRenameTitle("");
    }
  };

  const submitDelete = async () => {
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
            setCurrentSessionId(remaining[0].id);
            loadMessages(remaining[0].id);
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
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const compressedDataUrl = await compressImageFile(file, {
          maxWidth: 1536,
          maxHeight: 1536,
          quality: 0.82,
        });
        setImages((prev) => [...prev, compressedDataUrl]);
      } catch {
        showToast("图片处理失败", "error");
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const copyToClipboard = (text: string, id: number | string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast("已复制到剪贴板");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const send = async (overridePrompt?: string) => {
    const textToSend = overridePrompt ?? input;
    if ((!textToSend.trim() && images.length === 0) || streaming) return;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      const firstLine = textToSend.trim().slice(0, 20) || "新对话";
      activeSessionId = await createSession(firstLine);
      if (!activeSessionId) return;
    }

    const userMsg: Message = {
      role: "user",
      content: textToSend.trim(),
      images: images.length > 0 ? images : undefined,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setImages([]);
    setStreaming(true);

    const assistantMsgIndex = messages.length + 1;
    let fullReasoning = "";
    let fullContent = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: userMsg.content,
          images: userMsg.images,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("无响应数据流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            if (data.type === "reasoning") {
              fullReasoning += data.text;
            } else if (data.type === "content") {
              fullContent += data.text;
            }

            setMessages((prev) => {
              const next = [...prev];
              next[assistantMsgIndex] = {
                role: "assistant",
                content: fullContent,
                reasoning_content: fullReasoning || undefined,
                created_at: new Date().toISOString(),
              };
              return next;
            });
          } catch {
            // ignore JSON parse errors on malformed chunks
          }
        }
      }

      // Update session title if it's the first message and still named "新对话"
      const currSession = sessions.find((s) => s.id === activeSessionId);
      if (currSession && (currSession.title === "新对话" || !currSession.title)) {
        const newTitle = userMsg.content.slice(0, 16) || "新对话";
        fetch(`/api/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        }).then(() => {
          setSessions((prev) =>
            prev.map((s) => (s.id === activeSessionId ? { ...s, title: newTitle } : s))
          );
        });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "连接失败";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ 对话出错：${errorMsg}。\n\n请检查「设置」页中的 API Key 与 Base URL 是否正确。`,
          created_at: new Date().toISOString(),
        },
      ]);
      showToast("发送失败，请检查配置", "error");
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const triggerConsolidate = async () => {
    if (!currentSessionId || consolidating) return;
    setConsolidating(true);
    try {
      const res = await fetch("/api/consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
      const data = (await res.json()) as { staged?: StagedCandidate[]; count?: number };
      if (data.staged && data.staged.length > 0) {
        setStaged(data.staged);
        showToast(`已提取 ${data.staged.length} 条记忆沉淀！`);
      } else {
        showToast("本轮对话暂无需要沉淀的重要新记忆");
      }
    } catch {
      showToast("整理记忆失败", "error");
    } finally {
      setConsolidating(false);
    }
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId),
    [sessions, currentSessionId]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
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

      {/* Desktop Session Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-surface/50 transition-all duration-200 shrink-0",
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
        )}
      >
        <div className="p-3 border-b border-border space-y-2">
          <Button
            onClick={() => createSession()}
            className="w-full justify-start gap-2 h-9"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            <span>开启新思考</span>
          </Button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索历史对话..."
              className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted">
              {searchQuery ? "未找到相关对话" : "暂无对话记录"}
            </div>
          ) : (
            filteredSessions.map((s) => {
              const isActive = s.id === currentSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors",
                    isActive
                      ? "bg-accent-soft text-foreground font-medium border border-accent/25"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                    <MessageSquare
                      className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-accent" : "text-muted")}
                    />
                    <span className="truncate">{s.title || "无标题对话"}</span>
                  </div>

                  {/* Actions */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameTarget(s);
                        setRenameTitle(s.title);
                      }}
                      className="p-1 rounded hover:bg-surface text-muted hover:text-foreground"
                      title="重命名"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(s);
                      }}
                      className="p-1 rounded hover:bg-danger-soft text-muted hover:text-danger"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-background relative">
        {/* Top Header */}
        <header className="h-14 border-b border-border px-4 flex items-center justify-between shrink-0 bg-surface/30 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2 min-w-0">
            {/* Desktop Sidebar Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen((v) => !v)}
              className="hidden md:flex h-8 w-8 p-0"
              title={sidebarOpen ? "折叠侧栏" : "展开侧栏"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4 text-muted" />
              ) : (
                <PanelLeft className="h-4 w-4 text-muted" />
              )}
            </Button>

            {/* Mobile Sessions Drawer Trigger */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMobileDrawerOpen(true)}
              className="md:hidden h-8 px-2.5 text-xs gap-1.5"
            >
              <MessageSquare className="h-3.5 w-3.5 text-accent" />
              <span>历史 ({sessions.length})</span>
            </Button>

            {/* Current Session Title */}
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground truncate max-w-[180px] sm:max-w-xs md:max-w-md">
                {currentSession?.title || "思考伙伴"}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={triggerConsolidate}
                disabled={consolidating}
                className="h-8 text-xs gap-1.5"
                title="提取并沉淀本次对话的重要认知与决定"
              >
                <Sparkles className={cn("h-3.5 w-3.5 text-accent", consolidating && "animate-spin")} />
                <span className="hidden sm:inline">{consolidating ? "提取中..." : "整理记忆"}</span>
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              onClick={() => createSession()}
              className="h-8 text-xs gap-1 px-2.5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">新对话</span>
            </Button>
          </div>
        </header>

        {/* Messages Stream Container */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-8 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center px-4 py-8">
              <div className="mb-4">
                <BrandIcon size={52} className="shadow-lg" />
              </div>
              <h3 className="text-lg font-semibold text-foreground tracking-tight">
                你的个人深度思考伙伴
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed max-w-md">
                我不奉承、不迎合。我记住你的价值观、人生焦点与反复纠结，在对话中对照过去，帮你发现盲点与认知矛盾。
              </p>

              {/* Starter Prompts Grid */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                {STARTER_PROMPTS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => send(item.title + "：" + item.desc)}
                      className="group p-3.5 rounded-xl border border-border bg-surface hover:bg-surface-hover hover:border-accent/40 transition-all text-left flex flex-col justify-between"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon className="h-4 w-4 text-accent" />
                        <span className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted leading-relaxed line-clamp-2">
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg, idx) => {
                const isUser = msg.role === "user";
                const isStreamingCurrent = streaming && idx === messages.length - 1;

                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex gap-3 group animate-in fade-in duration-200",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    {/* Avatar */}
                    <div
                      className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border text-xs font-medium",
                        isUser
                          ? "bg-accent text-accent-foreground border-accent"
                          : "bg-surface-2 border-border text-foreground"
                      )}
                    >
                      {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-accent" />}
                    </div>

                    {/* Content Box */}
                    <div
                      className={cn(
                        "flex flex-col max-w-[88%] sm:max-w-[82%]",
                        isUser ? "items-end" : "items-start w-full min-w-0"
                      )}
                    >
                      {/* Attached Images (if user sent images) */}
                      {(() => {
                        const attachedImages = parseMsgImages(msg.images);
                        return attachedImages.length > 0 ? (
                          <div className={cn("flex flex-wrap gap-2 mb-2", isUser && "justify-end")}>
                            {attachedImages.map((img, i) => (
                              <img
                                key={i}
                                src={img}
                                alt="attached"
                                className="max-h-48 max-w-xs rounded-xl border border-border/80 object-cover shadow-xs"
                              />
                            ))}
                          </div>
                        ) : null;
                      })()}

                      {/* Reasoning Box (Thinker step) */}
                      {!isUser && msg.reasoning_content && (
                        <div className="w-full mb-3 rounded-xl border border-border/60 bg-surface/60 overflow-hidden text-xs">
                          <button
                            onClick={() => setReasoningOpen((v) => !v)}
                            className="w-full px-3.5 py-2 flex items-center justify-between text-muted hover:text-foreground bg-surface-2/40 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5 font-medium tracking-wide">
                              <Brain className="h-3.5 w-3.5 text-accent" />
                              <span>对照与深度思考过程</span>
                              {isStreamingCurrent && (
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
                              )}
                            </span>
                            <div className="flex items-center gap-1 text-[11px] text-muted">
                              <span>{reasoningOpen ? "收起思考" : "展开思考"}</span>
                              {reasoningOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </div>
                          </button>
                          {reasoningOpen && (
                            <div className="p-3.5 border-t border-border/40 font-mono text-[11px] text-muted leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-background/30">
                              {msg.reasoning_content}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Bubble */}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 leading-relaxed transition-all",
                          isUser
                            ? "bg-surface-2 border border-border text-foreground font-normal rounded-tr-xs shadow-xs text-sm"
                            : "bg-surface border border-border/70 text-foreground rounded-tl-xs shadow-xs text-[14.5px] w-full"
                        )}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        ) : (
                          <div className="prose-chat">
                            <Markdown content={msg.content || (isStreamingCurrent ? "正在深思..." : "")} />
                            {isStreamingCurrent && (
                              <span className="inline-block h-3.5 w-1.5 bg-accent ml-1 animate-pulse align-middle" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Message footer & copy action */}
                      <div
                        className={cn(
                          "flex items-center gap-2 mt-1.5 px-1 text-[10px] text-muted",
                          isUser ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        {msg.created_at && (
                          <span>
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        {!isUser && msg.content && (
                          <button
                            onClick={() => copyToClipboard(msg.content, idx)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-foreground"
                            title="复制内容"
                          >
                            {copiedId === idx ? (
                              <Check className="h-3 w-3 text-accent" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Staged candidates card if consolidation produced memories */}
              {staged.length > 0 && (
                <div className="my-6 p-4 rounded-xl border border-accent/40 bg-accent-soft/40 animate-in fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                      <Sparkles className="h-4 w-4" />
                      <span>本次对话提炼出的记忆沉淀（已存入暂存库）</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStaged([])}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3.5 w-3.5 text-muted" />
                    </Button>
                  </div>
                  <div className="space-y-2 mt-3">
                    {staged.map((c, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-surface border border-border text-xs">
                        <div className="flex items-center gap-1.5 text-muted mb-1">
                          <Badge variant="accent" className="text-[10px] py-0 px-1.5">
                            {c.type}
                          </Badge>
                          <span className="font-medium text-foreground">{c.title}</span>
                        </div>
                        <p className="text-muted leading-relaxed text-[11px]">{c.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 sm:p-4 bg-background/95 backdrop-blur border-t border-border">
          <div className="max-w-3xl mx-auto">
            {/* Image Preview strip */}
            {images.length > 0 && (
              <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-surface border border-border overflow-x-auto">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group shrink-0">
                    <img
                      src={img}
                      alt="preview"
                      className="h-14 w-14 rounded object-cover border border-border"
                    />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-danger text-white flex items-center justify-center text-[10px] shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative rounded-2xl border border-border bg-surface focus-within:border-accent/70 focus-within:ring-1 focus-within:ring-accent/40 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="说说你最近的纠结、重大决定或真实想法..."
                className="w-full resize-none bg-transparent px-4 pt-3.5 pb-10 text-sm text-foreground placeholder:text-muted/60 focus:outline-none max-h-44 min-h-[48px]"
              />

              <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-7 w-7 p-0 text-muted hover:text-foreground"
                    title="上传图片/截图"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="hidden md:inline text-[11px] text-muted/60">
                    Shift+Enter 换行
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => send()}
                    disabled={(!input.trim() && images.length === 0) || streaming}
                    className="h-8 w-8 p-0 rounded-full shrink-0"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Sessions Drawer */}
      <Dialog open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
        <DialogContent className="max-w-md w-[92vw] p-5">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" />
              <span>历史对话</span>
              <span className="text-xs font-normal text-muted">({sessions.length})</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 mt-1">
            <Button
              size="sm"
              variant="primary"
              onClick={() => createSession()}
              className="w-full justify-center gap-1.5 h-9 font-medium"
            >
              <Plus className="h-4 w-4" />
              <span>开启新对话</span>
            </Button>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索历史对话..."
                className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 my-3 pr-1">
            {filteredSessions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">暂无历史记录</div>
            ) : (
              filteredSessions.map((s) => {
                const isActive = s.id === currentSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => selectSession(s.id)}
                    className={cn(
                      "flex items-center justify-between rounded-lg p-3 text-xs cursor-pointer",
                      isActive
                        ? "bg-accent-soft text-accent font-medium border border-accent/30"
                        : "bg-surface text-foreground hover:bg-surface-2"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{s.title || "无标题对话"}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMobileDrawerOpen(false);
                          setRenameTarget(s);
                          setRenameTitle(s.title);
                        }}
                        className="p-1.5 rounded hover:bg-surface-2 text-muted"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMobileDrawerOpen(false);
                          setDeleteTarget(s);
                        }}
                        className="p-1.5 rounded hover:bg-danger-soft text-muted hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Session Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>为这段思考指定一个清晰的标题</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
              placeholder="输入对话标题..."
              autoFocus
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={submitRename}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Session Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除对话</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title}」吗？对话中的消息将无法恢复（已提取至记忆库的内容仍会保留）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="danger" size="sm" onClick={submitDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
