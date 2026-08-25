// 聊天 UI 共享类型与纯函数：页面组件与展示组件之间的类型契约，避免循环引用
import type { ResearchPanelStep, RetrievalTrace } from "@/lib/agent/chat-events";

export interface WebSourceLite {
  title: string;
  url: string;
  publishedDate?: string | null;
}

export interface RetrievedMemory {
  id: number;
  title: string;
  type: string;
  theme?: string | null;
  content: string;
  relation?: "constitution" | "related" | "tension" | "openLoop" | "timeline";
}

export interface Message {
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
  /** 本轮检索依据分类（核心记忆/张力/演进/外部资料） */
  toolTraces?: RetrievalTrace[];
  /** 是否由深度思考模式生成 */
  deepThinking?: boolean;
  /** 是否由深度研究模式生成 */
  deepResearch?: boolean;
  /** 深度研究面板：工具调用步骤（按时间追加） */
  researchSteps?: ResearchPanelStep[];
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface Candidate {
  id: number;
  type: string;
  title: string;
  content: string;
  importance: number;
  theme?: string | null;
}

export function parseMsgImages(images: unknown): string[] {
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