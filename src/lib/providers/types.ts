export type ChatRole = "system" | "user" | "assistant";

/** OpenAI 兼容的多模态内容块（vision）。 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  /** 纯文本，或带图片的 multipart 内容（vision 模型格式） */
  content: string | ContentPart[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string;
  reasoning?: string;
  model: string;
  usage?: ChatUsage;
}

export type StreamChunk =
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; usage?: ChatUsage };

export type AgentRole = "thinker" | "extractor" | "embedder" | "searcher";

/** 角色级覆盖：都可独立，留空回退全局。典型用法：thinker 走 A 家、embedder 走 B 家。 */
export interface RoleOverride {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  /** 仅 embedder 用：向量维度。换维度=换模型语义，需重嵌。 */
  dimensions?: number;
}
// searcher 只用 baseUrl/apiKey（搜索服务不是 OpenAI 兼容协议，没有 model 概念）。

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 所有 AI 调用的唯一抽象。业务代码禁止 import 具体厂商实现，
 * 只能通过 registry.resolveProvider(role) 拿到实例。
 *
 * 注意：embed 是可选能力。当前主用 provider 没有 embeddings 端点，
 * 调用方必须容忍 undefined 并降级到非向量检索路径。
 */
export interface AIProvider {
  readonly config: ProviderConfig;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
  chatStream(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncGenerator<StreamChunk>;
  embed?(texts: string[], opts?: { dimensions?: number }): Promise<number[][]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
