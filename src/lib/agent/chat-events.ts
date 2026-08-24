import type { WebSource } from "@/lib/providers/web-search";

/**
 * 一轮检索里某一「类别」的探查依据（如张力、演进、外部资料）。
 * 只描述调取到了什么，不伪造工具调用名，也没有运行态——事件发出即已完成。
 */
export interface RetrievalTrace {
  id: string;
  name: string;
  description: string;
  count: number;
  details?: string[];
}

export interface RetrievedMemorySummary {
  id: number;
  title: string;
  type: string;
  theme?: string | null;
  content: string;
  relation: "constitution" | "related" | "tension" | "openLoop" | "timeline";
}

/** SSE 事件协议：orchestrator 生成、stream-manager 转发、chat 路由直发。改这里即改协议。 */
export type OrchestratorEvent =
  | { type: "meta"; sessionId: number; title: string; userMessageId: number }
  | { type: "status"; text: string }
  | { type: "trace"; trace: RetrievalTrace }
  | {
      type: "context";
      themes: string[];
      memories: RetrievedMemorySummary[];
      traces?: RetrievalTrace[];
      deepThinking?: boolean;
    }
  | { type: "web"; mode: "read" | "search"; sources: WebSource[] }
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; candidatesAdded: number };