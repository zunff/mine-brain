"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Activity,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  Globe,
  History,
  Layers,
  Microscope,
  RotateCcw,
  ShieldAlert,
  Target,
  Trash2,
  User,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Message } from "./types";
import { parseMsgImages } from "./types";

const RESEARCH_TOOL_LABEL: Record<string, string> = {
  memory_search: "记忆检索",
  memory_tension: "过去的对立观点",
  memory_timeline: "立场变化",
  open_loop_search: "没解开的心结",
  web_search: "外部检索",
  web_fetch: "深读网页",
};

interface ChatMessageProps {
  msg: Message;
  idx: number;
  /** 全局流式状态（用于「重新思考」按钮可用的判断） */
  streaming: boolean;
  /** 本条是否正在流式生成 */
  isStreamingCurrent: boolean;
  streamingStatus: string;
  streamingElapsed: number;
  expandedThought: boolean;
  isCopied: boolean;
  isEditing: boolean;
  isLast: boolean;
  /** 该轮可删除（非流式且命中一个用户消息+答复对） */
  canDeletePair: boolean;
  onToggleThought: (idx: number) => void;
  onCopy: (idx: number) => void;
  onRegenerate: (idx: number) => void;
  onEdit: (idx: number) => void;
  onDeletePair: (idx: number) => void;
}

export default function ChatMessage({
  msg,
  idx,
  streaming,
  isStreamingCurrent,
  streamingStatus,
  streamingElapsed,
  expandedThought,
  isCopied,
  isEditing,
  isLast,
  canDeletePair,
  onToggleThought,
  onCopy,
  onRegenerate,
  onEdit,
  onDeletePair,
}: ChatMessageProps) {
  const isUser = msg.role === "user";
  // 深度研究/深度思考是同族深度工作，标签分开以示区别
  const isResearch = msg.deepResearch === true;
  const isDeepThink = msg.deepThinking === true;
  const modeLabel = isResearch ? "深度研究" : isDeepThink ? "深度思考" : null;

  // 思考过程内部滚动容器 Ref 与用户滚动意图标记
  const reasoningContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledReasoningRef = useRef(false);

  // 思考过程流式打字输出时：若用户未主动往上翻看，自动跟随最新输出滚到底部
  useEffect(() => {
    if (isStreamingCurrent && !msg.content && reasoningContainerRef.current) {
      if (!userScrolledReasoningRef.current) {
        reasoningContainerRef.current.scrollTop = reasoningContainerRef.current.scrollHeight;
      }
    }
  }, [msg.reasoning_content, isStreamingCurrent, msg.content]);

  // 思考阶段结束或开始输出正文时，重置手动滚动标记
  useEffect(() => {
    if (!isStreamingCurrent || Boolean(msg.content)) {
      userScrolledReasoningRef.current = false;
    }
  }, [isStreamingCurrent, msg.content]);

  const handleReasoningScroll = useCallback(() => {
    const el = reasoningContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    userScrolledReasoningRef.current = !isNearBottom;
  }, []);

  // 深度研究的结构化查证步骤
  const hasResearchSteps = isResearch && Boolean(msg.researchSteps && msg.researchSteps.length > 0);
  const visibleTraces = (msg.toolTraces ?? []).filter(
    (t) => !hasResearchSteps || !t.id.startsWith("trace_research_"),
  );
  const hasRetrievedMemories = Boolean(msg.retrievedMemories && msg.retrievedMemories.length > 0);
  const hasReasoning = Boolean(msg.reasoning_content);
  const hasWebSources = !hasResearchSteps && Boolean(msg.webSources && msg.webSources.length > 0);

  // 是否存在前置探查与思考内容（只要有检索、研究步骤、思考过程或正处于流式生成中）
  const hasThoughtBox =
    !isUser &&
    (hasResearchSteps ||
      visibleTraces.length > 0 ||
      hasRetrievedMemories ||
      hasReasoning ||
      hasWebSources ||
      (isStreamingCurrent && (Boolean(streamingStatus) || !msg.content)));

  // 正文气泡展示条件（方案一：出正文前聚焦上方思考盒，消除下方重复的 loading 卡片）：
  // 1. 用户消息必显
  // 2. 有正文内容（msg.content）必显
  // 3. 流式中且无正文：若上方已有思考/探查盒，完全隐藏下方气泡；仅在极简无思考盒时由气泡展示 loading
  // 4. 静态非流式且无正文（异常/空回复态）：展示重试占位提示
  const showBubble =
    isUser ||
    Boolean(msg.content) ||
    !isStreamingCurrent ||
    !hasThoughtBox;

  // 生成折叠栏摘要文案
  const renderThoughtHeader = () => {
    // 1. 流式中且尚未产出正文：显示实时动态
    if (isStreamingCurrent && !msg.content) {
      if (streamingStatus) return streamingStatus;
      const actionText = hasResearchSteps
        ? "正在查证与深度思考"
        : isDeepThink
        ? "正在深度思考与对照"
        : "正在思考与对照历史记忆";
      return `${modeLabel ? `${modeLabel} · ` : ""}${actionText} (${streamingElapsed.toFixed(1)}s)...`;
    }

    // 2. 完成态 / 静态：组合前缀与统计细节
    const prefix = isResearch
      ? "深度研究"
      : isDeepThink
      ? "深度思考"
      : hasReasoning
      ? "思考过程与依据"
      : "本轮检索依据";

    const details: string[] = [];
    if (hasResearchSteps) {
      details.push(`${msg.researchSteps!.length} 步查证`);
    }
    if (hasRetrievedMemories) {
      details.push(`依据 ${msg.retrievedMemories!.length} 条记忆`);
    } else if (!hasResearchSteps && visibleTraces.length > 0) {
      details.push(`${visibleTraces.length} 类检索`);
    }
    if (hasWebSources) {
      details.push(`参考 ${msg.webSources!.length} 条外部资料`);
    }
    if (msg.reasoning_duration) {
      details.push(`耗时 ${msg.reasoning_duration.toFixed(1)}s`);
    }

    if (details.length === 0) {
      return prefix;
    }
    return `${prefix} · ${details.join(" · ")}`;
  };

  return (
    <div
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

        {/* Unified Cognitive Probes, Research Steps & Reasoning Box (统一前置探查与思考折叠盒 · 分段垂直流) */}
        {hasThoughtBox ? (
          <div
            className={cn(
              "w-full mb-3 rounded-xl border overflow-hidden text-xs transition-all shadow-xs",
              isStreamingCurrent && !msg.content
                ? "border-accent/40 bg-surface/80 animate-glow-breathe"
                : "border-border/60 bg-surface/50"
            )}
          >
            {/* Header / 折叠开关条 */}
            <button
              onClick={() => onToggleThought(idx)}
              aria-expanded={expandedThought ? "true" : "false"}
              aria-controls={`thought-body-${idx}`}
              className="w-full px-3.5 py-2 flex items-center justify-between text-muted hover:text-foreground bg-surface-2/30 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 font-medium tracking-wide min-w-0">
                {isResearch ? (
                  <Microscope
                    className={cn(
                      "h-3.5 w-3.5 text-accent shrink-0",
                      isStreamingCurrent && !msg.content && "animate-pulse"
                    )}
                  />
                ) : (
                  <Brain
                    className={cn(
                      "h-3.5 w-3.5 text-accent shrink-0",
                      isStreamingCurrent && !msg.content && "animate-pulse"
                    )}
                  />
                )}
                <span className="truncate">{renderThoughtHeader()}</span>
                {isStreamingCurrent && !msg.content && (
                  <span className="flex items-center gap-1 ml-0.5 shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-1" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-2" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-floating-3" />
                  </span>
                )}
                {(!isStreamingCurrent || Boolean(msg.content)) &&
                  msg.retrievedThemes &&
                  msg.retrievedThemes.length > 0 && (
                    <span className="text-[10px] text-muted font-normal hidden md:inline ml-1 shrink-0">
                      · 关联生活域: {msg.retrievedThemes.join(" / ")}
                    </span>
                  )}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-muted shrink-0 ml-2">
                <span>{expandedThought ? "收起详情" : "展开详情"}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-250 ease-out",
                    expandedThought ? "rotate-0 text-foreground" : "-rotate-90 text-muted"
                  )}
                />
              </div>
            </button>

            {/* 展开后的分段垂直流（平滑高度与透明度过渡动画） */}
            <div
              className="collapse-grid"
              data-expanded={expandedThought ? "true" : "false"}
            >
              <div className="collapse-grid-inner">
                <div
                  id={`thought-body-${idx}`}
                  className={cn(
                    "p-3.5 border-t border-border/40 space-y-4 bg-background/20 transition-opacity duration-250 ease-out",
                    expandedThought ? "opacity-100" : "opacity-0"
                  )}
                >
                  {/* 1. 深度研究步骤 / 探查轨迹（时间轴节点流） */}
                {hasResearchSteps && (
                  <div className="space-y-2">
                    <div className="text-[10.5px] font-semibold text-muted/90 tracking-wide flex items-center gap-1.5">
                      <Microscope className="h-3.5 w-3.5 text-accent" />
                      <span>查证轨迹与探查动作 ({msg.researchSteps!.length} 步)</span>
                    </div>
                    <div className="relative pl-3.5 border-l-2 border-border/60 space-y-3 ml-1.5 py-0.5">
                      {msg.researchSteps!.map((s, i) => {
                        const hitCount = (s.memoryTitles?.length ?? 0) + (s.web?.length ?? 0);
                        return (
                          <div key={i} className="relative text-[11px] space-y-1">
                            {/* Timeline 节点小圆点 */}
                            <div className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full border-2 border-background bg-accent" />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-2 text-foreground border border-border/60 shadow-2xs">
                                {RESEARCH_TOOL_LABEL[s.tool] ?? s.tool}
                              </span>
                              <span
                                className="font-medium text-foreground text-[11.5px] truncate max-w-[420px]"
                                title={s.query}
                              >
                                「{s.query}」
                              </span>
                              <span className="text-[10px] text-muted font-mono bg-surface-2/60 px-1.5 py-0.5 rounded border border-border/40">
                                {hitCount} 条命中
                              </span>
                            </div>
                            {s.thinking && (
                              <p className="text-muted/75 text-[10.5px] leading-relaxed line-clamp-2">
                                <span className="text-muted font-medium">思路 · </span>
                                {s.thinking.replace(/^思路[·:：]\s*/, "")}
                              </p>
                            )}
                            {s.note && <p className="text-muted/70 text-[10.5px]">{s.note}</p>}
                            {s.memoryTitles && s.memoryTitles.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                <span className="text-[10px] text-muted shrink-0">命中:</span>
                                {s.memoryTitles.map((t, ti) => (
                                  <span
                                    key={ti}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent-soft/40 border border-accent/25 text-foreground text-[10px] truncate max-w-[220px]"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                            {s.web && s.web.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {s.web.map((w, wi) => (
                                  <a
                                    key={wi}
                                    href={w.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`${w.title} — ${w.url}`}
                                    className="inline-flex items-center gap-1 max-w-[240px] truncate rounded bg-surface border border-border/80 px-1.5 py-0.5 text-[10px] text-muted hover:text-accent hover:border-accent/40 transition-colors"
                                  >
                                    <Globe className="h-2.5 w-2.5 shrink-0 text-accent" />
                                    <span className="truncate">{w.title}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 2. 本轮检索依据分类（非深度研究时的常规/深度思考检索依据） */}
                {!hasResearchSteps && visibleTraces.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-semibold text-muted/90 tracking-wide flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-accent" />
                      <span>本轮检索依据</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {visibleTraces.map((t) => (
                        <div
                          key={t.id}
                          className="p-2 rounded-lg border border-border/50 bg-surface/70 flex items-start gap-2 text-[11px]"
                        >
                          <div className="mt-0.5 shrink-0">
                            {t.id === "trace_tension" ? (
                              <ShieldAlert className="h-3.5 w-3.5 text-danger" />
                            ) : t.id === "trace_timeline" ? (
                              <History className="h-3.5 w-3.5 text-accent" />
                            ) : t.id === "trace_web" ? (
                              <Globe className="h-3.5 w-3.5 text-accent" />
                            ) : (
                              <Target className="h-3.5 w-3.5 text-accent" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-foreground truncate">
                                {t.name}
                              </span>
                              <Badge variant="outline" className="text-[9px] py-0 px-1 font-mono">
                                {t.count} 条
                              </Badge>
                            </div>
                            <p className="text-muted text-[10px] line-clamp-1 mt-0.5">
                              {t.description}
                            </p>
                            {t.thinking && (
                              <p
                                className="text-muted/70 text-[10px] leading-snug line-clamp-2 mt-1 break-words"
                                title={`模型选定该查询时的思考：${t.thinking}`}
                              >
                                <span className="text-muted font-medium">思路 · </span>
                                {t.thinking.replace(/^思路[·:：]\s*/, "")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. 调取的长期记忆与信念明细 */}
                {hasRetrievedMemories && (
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-semibold text-muted/90 tracking-wide flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-accent" />
                      <span>调取的长期记忆与信念明细 ({msg.retrievedMemories!.length} 条)</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.retrievedMemories!.map((m) => {
                        const isTension = m.relation === "tension";
                        const isOpenLoop = m.relation === "openLoop";
                        const isConstitution = m.relation === "constitution";
                        const isTimeline = m.relation === "timeline";
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "p-2.5 rounded-lg border text-[11px] transition-all flex flex-col justify-between gap-1",
                              isTension
                                ? "border-danger/35 bg-danger-soft/20 hover:border-danger/50"
                                : isOpenLoop
                                ? "border-accent/35 bg-accent-soft/20 hover:border-accent/50"
                                : isConstitution
                                ? "border-amber-500/30 bg-amber-500/10 hover:border-amber-500/45"
                                : isTimeline
                                ? "border-border/70 bg-surface/70"
                                : "border-border/50 bg-surface-2/35"
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className={cn(
                                  "text-[9.5px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1",
                                  isTension
                                    ? "bg-danger/15 text-danger font-semibold"
                                    : isOpenLoop
                                    ? "bg-accent/15 text-accent font-semibold"
                                    : isConstitution
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                                    : isTimeline
                                    ? "bg-surface-2 text-foreground/80"
                                    : "bg-surface-2 text-muted"
                                )}
                              >
                                {isTension
                                  ? "⚠️ 打对台的过去想法"
                                  : isOpenLoop
                                  ? "🔄 反复绕不开的事"
                                  : isConstitution
                                  ? "📜 我的底色"
                                  : isTimeline
                                  ? "⏳ 想法的演变"
                                  : "🏷️ 相关记忆"}
                              </span>
                              {m.theme && (
                                <span className="text-[9.5px] text-muted/70 font-mono">
                                  {m.theme}
                                </span>
                              )}
                            </div>
                            <div className="font-medium text-foreground text-[11.5px] line-clamp-1 mt-0.5">
                              {m.title}
                            </div>
                            <p className="text-muted/80 text-[10.5px] line-clamp-2 leading-relaxed">
                              {m.content}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. 外部参考资料（仅常规联网问答时） */}
                {hasWebSources && (
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-semibold text-muted/90 tracking-wide flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-accent" />
                      <span>
                        参考外部资料 ({msg.webSources!.length} 条 · 仅为世界信息，不是你的记忆)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.webSources!.map((s, i) => (
                        <a
                          key={i}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${s.title} — ${s.url}`}
                          className="inline-flex items-center gap-1 max-w-[240px] truncate rounded bg-surface border border-border/80 px-2 py-1 text-[10.5px] text-muted hover:text-accent hover:border-accent/40 transition-colors"
                        >
                          <Globe className="h-2.5 w-2.5 shrink-0 text-accent" />
                          <span className="truncate">
                            {s.publishedDate ? `${s.publishedDate.slice(0, 10)} · ` : ""}
                            {s.title}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. 思考推导过程 */}
                {hasReasoning && (
                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-semibold text-muted/90 tracking-wide flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5 text-accent" />
                      <span>
                        模型思考推导过程
                        {msg.reasoning_duration
                          ? ` · 耗时 ${msg.reasoning_duration.toFixed(1)}s`
                          : ""}
                      </span>
                    </div>
                    <div
                      ref={reasoningContainerRef}
                      onScroll={handleReasoningScroll}
                      id={`reasoning-body-${idx}`}
                      className="p-3 rounded-lg border border-border/30 text-[11.5px] leading-relaxed prose-chat prose-chat-reasoning max-h-56 overflow-y-auto bg-surface-2/20 text-muted selection:bg-accent/20"
                    >
                      <Markdown content={msg.reasoning_content ?? ""} />
                      {isStreamingCurrent && !msg.content && (
                        <span className="inline-block h-3 w-1.5 bg-accent/70 ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

        {/* Bubble (正文气泡：仅在有正文、无上方思考盒或非流式空态时渲染，避免思考阶段出现上下双 loading 卡片) */}
        {showBubble ? (
          <div
            className={cn(
              "rounded-2xl px-4 py-3 leading-relaxed transition-all animate-in fade-in duration-200",
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
                  {streamingStatus ||
                    (isResearch
                      ? "正在深度研究查证与组织回应..."
                      : isDeepThink
                        ? "正在深度思考与组织回应..."
                        : "正在思考与组织回应...")}
                </span>
              </div>
            ) : !msg.content ? (
              <div className="text-xs text-muted italic py-0.5">
                这轮没有生成回复，可点击「重新思考」重试
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
        ) : null}

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
              onClick={() => onEdit(idx)}
              className={cn(
                "transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent",
                isEditing
                  ? "text-accent opacity-100"
                  : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              )}
              title="编辑此消息：发送将替换当时的一问一答"
            >
              <Edit3 className="h-3 w-3" />
              <span>{isEditing ? "正在编辑" : "编辑"}</span>
            </button>
          )}
          {!isUser && (
            <>
              {msg.content && (
                <button
                  onClick={() => onCopy(idx)}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent"
                  title="复制内容"
                >
                  {isCopied ? (
                    <Check className="h-3 w-3 text-accent" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{isCopied ? "已复制" : "复制"}</span>
                </button>
              )}
              {!streaming && isLast && (
                <button
                  onClick={() => onRegenerate(idx)}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-accent"
                  title="重新思考这轮对话"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>重新思考</span>
                </button>
              )}
              {canDeletePair && (
                <button
                  onClick={() => onDeletePair(idx)}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:text-foreground cursor-pointer text-muted hover:text-danger"
                  title="删除这一轮问答（不再进入后续对话上下文）"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>删除</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}