import {
  runChat,
  type OrchestratorEvent,
  type RunChatOptions,
  type RetrievedMemorySummary,
} from "./orchestrator";
import { getSession, createSession } from "@/lib/memory/repo";

export interface ActiveSessionStream {
  sessionId: number;
  title: string;
  events: OrchestratorEvent[];
  reasoning: string;
  content: string;
  statusText: string;
  retrievedMemories?: RetrievedMemorySummary[];
  retrievedThemes?: string[];
  isDone: boolean;
  error?: string;
  listeners: Set<(evt: OrchestratorEvent) => void>;
  startTime: number;
  cleanupTimer?: NodeJS.Timeout;
}

// 内存中维护的单例活跃流映射（sessionId -> ActiveSessionStream）
const activeStreams = new Map<number, ActiveSessionStream>();

/** 查询某个会话当前是否在后台活跃生成中 */
export function isSessionStreaming(sessionId: number): boolean {
  const stream = activeStreams.get(sessionId);
  return Boolean(stream && !stream.isDone);
}

/** 获取活跃流的当前快照数据 */
export function getActiveStream(sessionId: number): ActiveSessionStream | undefined {
  return activeStreams.get(sessionId);
}

/**
 * 启动新的后台流式任务，或订阅已存在的后台流。
 * 核心特性：客户端即使断开 HTTP 连接，后台任务仍会完整执行并持续写入 SQLite。
 */
export function startOrJoinChatStream(
  sessionId: number | null,
  userText: string,
  images?: string[],
  opts: RunChatOptions = {},
): {
  sessionId: number;
  subscribe: (onEvent: (evt: OrchestratorEvent) => void) => () => void;
} {
  // 1. 预先确定 sessionId
  let resolvedSessionId: number;
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) {
      resolvedSessionId = existing.id;
    } else {
      const created = createSession(deriveInitialTitle(userText || "图片对话"));
      resolvedSessionId = created.id;
    }
  } else {
    const created = createSession(deriveInitialTitle(userText || "新对话"));
    resolvedSessionId = created.id;
  }

  // 2. 如果已经有正在运行的流任务，直接复用
  let active = activeStreams.get(resolvedSessionId);
  if (!active || active.isDone) {
    if (active?.cleanupTimer) clearTimeout(active.cleanupTimer);

    active = {
      sessionId: resolvedSessionId,
      title: deriveInitialTitle(userText || "新对话"),
      events: [],
      reasoning: "",
      content: "",
      statusText: "正在调取历史记忆与价值观...",
      isDone: false,
      listeners: new Set(),
      startTime: Date.now(),
    };
    activeStreams.set(resolvedSessionId, active);

    // 启动后台生成任务（独立于任何单个 HTTP 连接）
    (async () => {
      const currentStream = active!;
      try {
        for await (const evt of runChat(resolvedSessionId, userText, images, opts)) {
          currentStream.events.push(evt);

          if (evt.type === "meta") {
            currentStream.title = evt.title;
          } else if (evt.type === "status") {
            currentStream.statusText = evt.text;
          } else if (evt.type === "context") {
            currentStream.retrievedThemes = evt.themes;
            currentStream.retrievedMemories = evt.memories;
          } else if (evt.type === "reasoning") {
            currentStream.reasoning += evt.text;
          } else if (evt.type === "content") {
            currentStream.content += evt.text;
          } else if (evt.type === "done") {
            currentStream.isDone = true;
          }

          // 广播给所有当前在线的客户端
          for (const listener of currentStream.listeners) {
            try {
              listener(evt);
            } catch {
              /* ignore listener dispatch failure */
            }
          }
        }
      } catch (err) {
        console.error(`[stream-manager] session ${resolvedSessionId} failed:`, err);
        const errorText =
          err instanceof Error && /API key|401|403/i.test(err.message)
            ? "AI 服务鉴权失败。请到「设置」检查 API Key 与模型配置。"
            : `出错了：${err instanceof Error ? err.message : String(err)}`;
        const errEvent: OrchestratorEvent = { type: "content", text: errorText };
        currentStream.events.push(errEvent);
        currentStream.events.push({ type: "done", candidatesAdded: 0 });
        for (const listener of currentStream.listeners) {
          try {
            listener(errEvent);
            listener({ type: "done", candidatesAdded: 0 });
          } catch {
            /* ignore */
          }
        }
      } finally {
        currentStream.isDone = true;
        // 完成后保留 45 秒供可能刚刚重连的客户端拉取最终状态，然后清理
        currentStream.cleanupTimer = setTimeout(() => {
          activeStreams.delete(resolvedSessionId);
        }, 45000);
      }
    })();
  }

  // 3. 返回订阅函数
  const targetStream = active;
  const subscribe = (onEvent: (evt: OrchestratorEvent) => void): (() => void) => {
    // 立即回放所有已生成的历史事件
    for (const evt of targetStream.events) {
      onEvent(evt);
    }

    if (targetStream.isDone) {
      // 已经完成则无需挂载新 listener
      return () => {};
    }

    targetStream.listeners.add(onEvent);
    return () => {
      targetStream.listeners.delete(onEvent);
    };
  };

  return { sessionId: resolvedSessionId, subscribe };
}

/** 仅订阅现有的后台流式任务（用于切换回会话时的断点重连） */
export function subscribeExistingChatStream(
  sessionId: number,
  onEvent: (evt: OrchestratorEvent) => void,
): (() => void) | null {
  const active = activeStreams.get(sessionId);
  if (!active || active.isDone) {
    return null;
  }

  // 回放已有事件
  for (const evt of active.events) {
    onEvent(evt);
  }

  if (active.isDone) {
    return () => {};
  }

  active.listeners.add(onEvent);
  return () => {
    active.listeners.delete(onEvent);
  };
}

function deriveInitialTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 18 ? clean : clean.slice(0, 18) + "…";
}
