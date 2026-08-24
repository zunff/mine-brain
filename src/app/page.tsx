"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Globe,
  RotateCcw,
  Layers,
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
import { assertOk, cn } from "@/lib/utils";

interface WebSourceLite {
  title: string;
  url: string;
  publishedDate?: string | null;
}

interface RetrievedMemory {
  id: number;
  title: string;
  type: string;
  theme?: string | null;
  content: string;
  relation?: "constitution" | "related" | "tension" | "openLoop";
}

interface Message {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string;
  reasoning_duration?: number;
  images?: string[];
  created_at?: string;
  /** 本轮联网参考的外部资料（仅当次会话内存中，不持久化） */
  webSources?: WebSourceLite[];
  /** 本轮调取的历史记忆与生活域 */
  retrievedMemories?: RetrievedMemory[];
  retrievedThemes?: string[];
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

interface Candidate {
  id: number;
  type: string;
  title: string;
  content: string;
  importance: number;
  theme?: string | null;
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
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [consolidating, setConsolidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // 独立的思考框折叠状态（按消息索引），流式中当前消息默认展开
  const [expandedReasoningMap, setExpandedReasoningMap] = useState<Record<number, boolean>>({});
  // 独立的记忆检索折叠状态（按消息索引）
  const [expandedContextMap, setExpandedContextMap] = useState<Record<number, boolean>>({});
  // 流式过程中的实时动态状态文案（调取记忆中 / 联网检索中 / 深度思考中）
  const [streamingStatus, setStreamingStatus] = useState<string>("");
  // 思考耗时实时秒数（计时器）
  const [streamingElapsed, setStreamingElapsed] = useState<number>(0);

  // 打字机缓冲引擎 Refs：负责在流式与断点重连时平滑输出字符
  const activeAssistantIndexRef = useRef<number | null>(null);
  const targetContentRef = useRef<string>("");
  const displayedContentRef = useRef<string>("");
  const targetReasoningRef = useRef<string>("");
  const targetWebSourcesRef = useRef<WebSourceLite[] | undefined>(undefined);
  const targetRetrievedMemoriesRef = useRef<RetrievedMemory[] | undefined>(undefined);
  const targetRetrievedThemesRef = useRef<string[] | undefined>(undefined);
  const isStreamDoneReceivedRef = useRef<boolean>(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const reasoningStartTimeRef = useRef<number | null>(null);
  const reasoningEndTimeRef = useRef<number | null>(null);

  // 联网开关：配置了搜索 key 才出现；记住上次的选择（localStorage 只存偏好）
  const [webOn, setWebOn] = useState(false);
  const [webAvailable, setWebAvailable] = useState(false);

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
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((text: string, type: "success" | "error" = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      // 本地偏好读取放进微任务：避免在 effect 体内同步 setState 触发级联渲染
      await Promise.resolve();
      try {
        const saved = localStorage.getItem("mine-brain.web") === "1";
        if (active) setWebOn(saved);
      } catch {
        /* 存储不可用时保持默认关 */
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

  const loadCandidates = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setCandidates([]);
      return;
    }
    try {
      const res = await fetch(`/api/candidates?sessionId=${sessionId}`);
      const data = (await res.json()) as { candidates: Candidate[] };
      setCandidates(data.candidates ?? []);
    } catch {
      setCandidates([]);
    }
  }, []);

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
        // 动态自适应追赶步长：落后 > 80 字步进 4 字，落后 > 25 字步进 2 字，其余步进 1 字
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
          };
          return updated;
        });
      } else {
        // 当文字已经追上目标且流式已完成
        if (isStreamDoneReceivedRef.current) {
          setStreaming(false);
          setStreamingStatus("");
          activeAssistantIndexRef.current = null;
          isStreamDoneReceivedRef.current = false;
        }
      }
    }, 25);

    return () => clearInterval(interval);
  }, []);

  const consumeSseReader = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      activeSessionId: string,
      assistantMsgIndex: number
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
              } else if (data.type === "context") {
                targetRetrievedThemesRef.current = Array.isArray(data.themes) ? data.themes : [];
                targetRetrievedMemoriesRef.current = Array.isArray(data.memories) ? data.memories : [];
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
                  setSessions((prev) =>
                    prev.map((s) => (s.id === activeSessionId ? { ...s, title: data.title } : s))
                  );
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
          loadCandidates(activeSessionId);
        }
      }
    },
    [loadCandidates]
  );

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

        const msgs = initialMessages ?? messages;
        let assistantIdx = msgs.length - 1;
        if (assistantIdx < 0 || msgs[assistantIdx].role !== "assistant") {
          const newDraft: Message = {
            role: "assistant",
            content: "",
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, newDraft]);
          assistantIdx = msgs.length;
        }

        const existingContent = msgs[assistantIdx]?.content || "";
        displayedContentRef.current = existingContent;
        targetContentRef.current = existingContent;
        targetReasoningRef.current = msgs[assistantIdx]?.reasoning_content || "";
        activeAssistantIndexRef.current = assistantIdx;
        isStreamDoneReceivedRef.current = false;
        setStreaming(true);
        setStreamingStatus("正在恢复思考内容...");

        const reader = res.body.getReader();
        await consumeSseReader(reader, sessionId, assistantIdx);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
      }
    },
    [consumeSseReader, messages]
  );

  const loadMessages = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = (await res.json()) as { messages: Message[]; isStreaming?: boolean };
        const msgList = data.messages ?? [];
        setMessages(msgList);

        // 如果后端当前还在后台生成中，立即无缝断点重连！
        if (data.isStreaming) {
          reconnectStream(sessionId, msgList);
        }
      } catch {
        setMessages([]);
      }
    },
    [reconnectStream]
  );

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
          const msgData = (await msgRes.json()) as { messages: Message[]; isStreaming?: boolean };
          if (active) {
            setMessages(msgData.messages ?? []);
            if (msgData.isStreaming) {
              reconnectStream(list[0].id, msgData.messages ?? []);
            }
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [reconnectStream]);

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
    // 切换会话时，主动中断当前前端与旧会话的 HTTP 连接（后端任务仍在后台继续不受影响）
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    setStreaming(false);
    activeAssistantIndexRef.current = null;
    isStreamDoneReceivedRef.current = false;
    displayedContentRef.current = "";
    targetContentRef.current = "";
    targetReasoningRef.current = "";

    setCurrentSessionId(id);
    setMobileDrawerOpen(false);
    await loadMessages(id);
    await loadCandidates(id);
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
        setCandidates([]);
        setMobileDrawerOpen(false);
        return data.session.id;
      }
    } catch {
      showToast("创建对话失败", "error");
    }
    return null;
  };

  /** 新对话：优先复用已存在的空会话，否则进入空白草稿（发送首条消息时才真正建会话）。 */
  const startNewChat = () => {
    const emptyNewest = sessions.find((s) => (s.message_count ?? 0) === 0);
    setMessages([]);
    setCandidates([]);
    setCurrentSessionId(emptyNewest ? emptyNewest.id : null);
    setMobileDrawerOpen(false);
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

  const toggleReasoning = (msgIndex: number) => {
    setExpandedReasoningMap((prev) => ({
      ...prev,
      [msgIndex]: !prev[msgIndex],
    }));
  };

  const toggleContext = (msgIndex: number) => {
    setExpandedContextMap((prev) => ({
      ...prev,
      [msgIndex]: !prev[msgIndex],
    }));
  };

  const send = async (overridePrompt?: string, overrideImages?: string[]) => {
    const textToSend = overridePrompt ?? input;
    const imgsToSend = overrideImages ?? images;
    if ((!textToSend.trim() && imgsToSend.length === 0) || streaming) return;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      const firstLine = textToSend.trim().slice(0, 20) || "新对话";
      activeSessionId = await createSession(firstLine);
      if (!activeSessionId) return;
    }

    const userMsg: Message = {
      role: "user",
      content: textToSend.trim(),
      images: imgsToSend.length > 0 ? imgsToSend : undefined,
      created_at: new Date().toISOString(),
    };

    const assistantMsgIndex = messages.length + 1;
    const initialAssistantMsg: Message = {
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setInput("");
    setImages([]);
    setStreaming(true);
    setStreamingStatus("正在调取历史记忆与价值观...");
    setStreamingElapsed(0);

    // 重置打字机缓冲
    displayedContentRef.current = "";
    targetContentRef.current = "";
    targetReasoningRef.current = "";
    targetWebSourcesRef.current = undefined;
    targetRetrievedMemoriesRef.current = undefined;
    targetRetrievedThemesRef.current = undefined;
    activeAssistantIndexRef.current = assistantMsgIndex;
    isStreamDoneReceivedRef.current = false;
    reasoningStartTimeRef.current = null;
    reasoningEndTimeRef.current = null;

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
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("无响应数据流");

      const reader = res.body.getReader();
      await consumeSseReader(reader, activeSessionId, assistantMsgIndex);

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
      setStreaming(false);
      isStreamDoneReceivedRef.current = false;
    } finally {
      if (activeSessionId) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, message_count: (s.message_count ?? 0) + 2 } : s
          )
        );
      }
    }
  };

  /** 重新生成某一轮助手回复 */
  const regenerate = async (assistantIdx: number) => {
    if (streaming) return;
    const prevUserMsg = messages[assistantIdx - 1];
    if (!prevUserMsg || prevUserMsg.role !== "user") return;

    // 移除从上一条用户消息开始的内容并重新发送
    setMessages((prev) => prev.slice(0, assistantIdx - 1));
    await send(prevUserMsg.content, prevUserMsg.images);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /** 手动触发一次整理（自动整理每轮已跑过），然后刷新候选列表。 */
  const triggerConsolidate = async () => {
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
  };

  /** 确认/拒绝记忆候选：确认才真正入库（+标签+关联边+向量化）。 */
  const decideCandidate = async (id: number, decision: "approve" | "reject") => {
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
            onClick={startNewChat}
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
              onClick={startNewChat}
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

                      {/* Context Memories Box (调取的历史记忆与张力) */}
                      {!isUser && msg.retrievedMemories && msg.retrievedMemories.length > 0 && (
                        <div className="w-full mb-2 rounded-xl border border-border/60 bg-surface/50 overflow-hidden text-xs transition-all">
                          <button
                            onClick={() => toggleContext(idx)}
                            className="w-full px-3 py-2 flex items-center justify-between text-muted hover:text-foreground bg-surface-2/30 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5 font-medium tracking-wide">
                              <Layers className="h-3.5 w-3.5 text-accent" />
                              <span>调取了 {msg.retrievedMemories.length} 条历史记忆与张力</span>
                              {msg.retrievedThemes && msg.retrievedThemes.length > 0 && (
                                <span className="text-[10px] text-muted font-normal hidden sm:inline ml-1">
                                  · 关联生活域: {msg.retrievedThemes.join(" / ")}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1 text-[11px] text-muted">
                              <span>{expandedContextMap[idx] ? "收起" : "展开"}</span>
                              {expandedContextMap[idx] ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </div>
                          </button>
                          {expandedContextMap[idx] && (
                            <div className="p-2.5 border-t border-border/40 space-y-1.5 bg-background/25">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {msg.retrievedMemories.map((m) => {
                                  const isTension = m.relation === "tension";
                                  const isOpenLoop = m.relation === "openLoop";
                                  const isConstitution = m.relation === "constitution";
                                  return (
                                    <div
                                      key={m.id}
                                      className={cn(
                                        "p-2 rounded-lg border text-[11px] transition-colors",
                                        isTension
                                          ? "border-danger/30 bg-danger-soft/20 text-foreground"
                                          : isOpenLoop
                                          ? "border-accent/30 bg-accent-soft/20 text-foreground"
                                          : "border-border/60 bg-surface-2/40 text-foreground"
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                        <Badge
                                          variant={isTension ? "danger" : isConstitution ? "accent" : "outline"}
                                          className="text-[9px] py-0 px-1 font-medium"
                                        >
                                          {isTension
                                            ? "⚠️ 历史张力"
                                            : isOpenLoop
                                            ? "🔄 未解纠结"
                                            : isConstitution
                                            ? "📜 核心宪章"
                                            : "🏷️ 相关记忆"}
                                        </Badge>
                                        {m.theme && (
                                          <span className="text-[10px] text-muted">
                                            {m.theme}
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-medium text-foreground line-clamp-1">{m.title}</div>
                                      <p className="text-muted text-[10px] line-clamp-2 mt-0.5 leading-relaxed">
                                        {m.content}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Reasoning Box (Thinker step with timing & floating animation) */}
                      {!isUser && msg.reasoning_content && (
                        <div
                          className={cn(
                            "w-full mb-3 rounded-xl border overflow-hidden text-xs transition-all",
                            isStreamingCurrent && !msg.content
                              ? "border-accent/40 bg-surface/80 shadow-xs animate-glow-breathe"
                              : "border-border/60 bg-surface/60"
                          )}
                        >
                          <button
                            onClick={() => toggleReasoning(idx)}
                            className="w-full px-3.5 py-2 flex items-center justify-between text-muted hover:text-foreground bg-surface-2/40 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2 font-medium tracking-wide">
                              <Brain
                                className={cn(
                                  "h-3.5 w-3.5 text-accent",
                                  isStreamingCurrent && !msg.content && "animate-pulse"
                                )}
                              />
                              <span>
                                {isStreamingCurrent && !msg.content
                                  ? `深度对照与思考中 (${streamingElapsed.toFixed(1)}s)...`
                                  : `对照与深度思考过程${
                                      msg.reasoning_duration
                                        ? ` · 耗时 ${msg.reasoning_duration.toFixed(1)}s`
                                        : ""
                                    }`}
                              </span>
                              {isStreamingCurrent && !msg.content && (
                                <span className="flex items-center gap-1 ml-0.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-1" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-2" />
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-3" />
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-1 text-[11px] text-muted">
                              <span>
                                {expandedReasoningMap[idx] ?? isStreamingCurrent
                                  ? "收起思考"
                                  : "展开思考"}
                              </span>
                              {expandedReasoningMap[idx] ?? isStreamingCurrent ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </div>
                          </button>
                          {(expandedReasoningMap[idx] ?? isStreamingCurrent) && (
                            <div className="p-3.5 border-t border-border/40 font-mono text-[11px] text-muted leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-background/30">
                              {msg.reasoning_content}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Web Sources (本轮联网参考，带来源与时间) */}
                      {!isUser && msg.webSources && msg.webSources.length > 0 && (
                        <div className="w-full mb-2 rounded-xl border border-border/60 bg-surface-2/40 px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-muted mb-1.5">
                            <Globe className="h-3 w-3 text-accent shrink-0" />
                            <span>参考了 {msg.webSources.length} 条外部资料 · 仅为世界信息，不是你的记忆</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.webSources.map((s, i) => (
                              <a
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${s.title} — ${s.url}`}
                                className="max-w-[260px] truncate rounded-md bg-surface border border-border px-2 py-1 text-[11px] text-muted hover:text-accent hover:border-accent/40 transition-colors"
                              >
                                {s.publishedDate ? `${s.publishedDate.slice(0, 10)} · ` : ""}
                                {s.title}
                              </a>
                            ))}
                          </div>
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
                        ) : !msg.content && isStreamingCurrent ? (
                          <div className="flex items-center gap-2 text-xs text-muted py-0.5">
                            <div className="flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-1" />
                              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-2" />
                              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-3" />
                            </div>
                            <span className="animate-pulse-subtle font-medium">
                              {streamingStatus || "正在深度思考与组织回应..."}
                            </span>
                          </div>
                        ) : (
                          <div className="prose-chat">
                            <Markdown content={msg.content} />
                            {isStreamingCurrent && (
                              <span className="inline-block h-3.5 w-1.5 bg-accent ml-1 animate-pulse align-middle" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Message footer & actions */}
                      <div
                        className={cn(
                          "flex items-center gap-3 mt-1.5 px-1 text-[11px] text-muted",
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
                        {isUser && (
                          <button
                            onClick={() => {
                              setInput(msg.content);
                              textareaRef.current?.focus();
                            }}
                            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent"
                            title="编辑此消息并填回输入框"
                          >
                            <Edit3 className="h-3 w-3" />
                            <span>编辑</span>
                          </button>
                        )}
                        {!isUser && msg.content && (
                          <>
                            <button
                              onClick={() => copyToClipboard(msg.content, idx)}
                              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent"
                              title="复制内容"
                            >
                              {copiedId === idx ? (
                                <Check className="h-3 w-3 text-accent" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>{copiedId === idx ? "已复制" : "复制"}</span>
                            </button>
                            {!streaming && idx === messages.length - 1 && (
                              <button
                                onClick={() => regenerate(idx)}
                                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent"
                                title="重新思考这轮对话"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>重新思考</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 待确认的记忆候选：确认后才真正入库 */}
              {candidates.length > 0 && (
                <div className="my-6 p-4 rounded-xl border border-accent/40 bg-accent-soft/40 animate-in fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                      <Sparkles className="h-4 w-4" />
                      <span>本次对话的记忆候选（确认后入库）</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCandidates([])}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-3.5 w-3.5 text-muted" />
                    </Button>
                  </div>
                  <div className="space-y-2 mt-3">
                    {candidates.map((c) => (
                      <div key={c.id} className="p-2.5 rounded-lg bg-surface border border-border text-xs">
                        <div className="flex items-center gap-1.5 text-muted mb-1">
                          <Badge variant="accent" className="text-[10px] py-0 px-1.5">
                            {c.type}
                          </Badge>
                          {c.title && (
                            <span className="font-medium text-foreground">{c.title}</span>
                          )}
                        </div>
                        <p className="text-muted leading-relaxed text-[11px] whitespace-pre-wrap">
                          {c.content}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => decideCandidate(c.id, "approve")}
                            className="h-6 px-2.5 text-[11px]"
                          >
                            <Check className="h-3 w-3 mr-1" />
                            确认
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => decideCandidate(c.id, "reject")}
                            className="h-6 px-2.5 text-[11px] text-muted hover:text-danger"
                          >
                            拒绝
                          </Button>
                        </div>
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
                  {webAvailable && (
                    <button
                      type="button"
                      onClick={toggleWeb}
                      title="开启后回复会参考实时网络资料（标注来源，不写入你的记忆）"
                      className={cn(
                        "h-7 rounded-md px-2 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer border",
                        webOn
                          ? "bg-accent-soft border-accent/40 text-accent"
                          : "border-transparent bg-transparent text-muted hover:text-foreground hover:bg-surface-2"
                      )}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">联网</span>
                    </button>
                  )}
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
              onClick={startNewChat}
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
