"use client";

import {
  Activity,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  Globe,
  History,
  Layers,
  RotateCcw,
  ShieldAlert,
  Target,
  User,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Message } from "./types";
import { parseMsgImages } from "./types";

interface ChatMessageProps {
  msg: Message;
  idx: number;
  /** 全局流式状态（用于「重新思考」按钮可用的判断） */
  streaming: boolean;
  /** 本条是否正在流式生成 */
  isStreamingCurrent: boolean;
  streamingStatus: string;
  streamingElapsed: number;
  expandedReasoning: boolean;
  expandedContext: boolean;
  isCopied: boolean;
  isEditing: boolean;
  isLast: boolean;
  onToggleReasoning: (idx: number) => void;
  onToggleContext: (idx: number) => void;
  onCopy: (idx: number) => void;
  onRegenerate: (idx: number) => void;
  onEdit: (idx: number) => void;
}

export default function ChatMessage({
  msg,
  idx,
  streaming,
  isStreamingCurrent,
  streamingStatus,
  streamingElapsed,
  expandedReasoning,
  expandedContext,
  isCopied,
  isEditing,
  isLast,
  onToggleReasoning,
  onToggleContext,
  onCopy,
  onRegenerate,
  onEdit,
}: ChatMessageProps) {
  const isUser = msg.role === "user";

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

        {/* Cognitive Probes & Context Box (多维认知探针与历史记忆对照) */}
        {!isUser && (msg.toolTraces?.length || msg.retrievedMemories?.length) ? (
          <div className="w-full mb-2.5 rounded-xl border border-border/60 bg-surface/50 overflow-hidden text-xs transition-all shadow-xs">
            <button
              onClick={() => onToggleContext(idx)}
              aria-expanded={expandedContext ? "true" : "false"}
              aria-controls={`context-body-${idx}`}
              className="w-full px-3.5 py-2 flex items-center justify-between text-muted hover:text-foreground bg-surface-2/30 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-medium tracking-wide">
                <Brain className="h-3.5 w-3.5 text-accent" />
                <span>
                  {msg.deepThinking
                    ? `深度思考 · 依据 ${
                        msg.retrievedMemories?.length ?? 0
                      } 条记忆与 ${msg.toolTraces?.length ?? 0} 类检索`
                    : `本轮检索依据 · ${msg.retrievedMemories?.length ?? 0} 条历史记忆`}
                </span>
                {msg.retrievedThemes && msg.retrievedThemes.length > 0 && (
                  <span className="text-[10px] text-muted font-normal hidden sm:inline ml-1">
                    · 关联生活域: {msg.retrievedThemes.join(" / ")}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-muted">
                <span>{expandedContext ? "收起探针" : "展开探查明细"}</span>
                {expandedContext ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </div>
            </button>

            {expandedContext && (
              <div
                id={`context-body-${idx}`}
                className="p-3 border-t border-border/40 space-y-3 bg-background/30 animate-in fade-in"
              >
                {/* 1. 本轮检索依据分类（如果存在 traces） */}
                {msg.toolTraces && msg.toolTraces.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                      <Activity className="h-3 w-3 text-accent" />
                      <span>本轮检索依据</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {msg.toolTraces.map((t) => (
                        <div
                          key={t.id}
                          className="p-2 rounded-lg border border-border/50 bg-surface/80 flex items-start gap-2 text-[11px]"
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
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. 具体记忆卡片明细 */}
                {msg.retrievedMemories && msg.retrievedMemories.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1">
                      <Layers className="h-3 w-3 text-accent" />
                      <span>调取的长期记忆与信念明细</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {msg.retrievedMemories.map((m) => {
                        const isTension = m.relation === "tension";
                        const isOpenLoop = m.relation === "openLoop";
                        const isConstitution = m.relation === "constitution";
                        const isTimeline = m.relation === "timeline";
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "p-2 rounded-lg border text-[11px] transition-colors",
                              isTension
                                ? "border-danger/35 bg-danger-soft/25 text-foreground"
                                : isOpenLoop
                                ? "border-accent/35 bg-accent-soft/25 text-foreground"
                                : isTimeline
                                ? "border-border/80 bg-surface/90 text-foreground"
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
                                  : isTimeline
                                  ? "⏳ 时间线演化"
                                  : isConstitution
                                  ? "📜 核心宪章"
                                  : "🏷️ 相关记忆"}
                              </Badge>
                              {m.theme && (
                                <span className="text-[10px] text-muted font-mono">
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
          </div>
        ) : null}

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
              onClick={() => onToggleReasoning(idx)}
              aria-expanded={expandedReasoning ? "true" : "false"}
              aria-controls={`reasoning-body-${idx}`}
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
                    ? `${msg.deepThinking ? "深度" : ""}对照与思考中 (${streamingElapsed.toFixed(1)}s)...`
                    : `${msg.deepThinking ? "深度思考过程" : "思考过程"}${
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
                  {expandedReasoning ? "收起思考" : "展开思考"}
                </span>
                {expandedReasoning ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </div>
            </button>
            {expandedReasoning && (
              <div
                id={`reasoning-body-${idx}`}
                className="p-3.5 border-t border-border/40 font-mono text-[11px] text-muted leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-background/30"
              >
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
                {streamingStatus ||
                  (msg.deepThinking
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}