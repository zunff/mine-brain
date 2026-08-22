import {
  AIProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatUsage,
  ProviderConfig,
  ProviderError,
  StreamChunk,
} from "./types";

interface WireChoiceDelta {
  content?: string | null;
  reasoning_content?: string | null;
}

/**
 * OpenAI 兼容协议适配器（/chat/completions，支持流式）。
 * 兼容推理模型：reasoning 走 delta.reasoning_content，正文走 delta.content。
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(readonly config: ProviderConfig) {}

  async chat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): Promise<ChatResponse> {
    let res!: Response;
    // 瞬时错误（429/5xx）重试：免费/共享网关偶发 500 不应打断整理流程
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      res = await this.request(messages, { ...opts, stream: false });
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
    }
    if (!res.ok) {
      throw new ProviderError(
        `provider chat failed: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    const data = (await res.json()) as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
      }>;
    };
    const choice = data.choices?.[0]?.message;
    return {
      content: choice?.content ?? "",
      reasoning: choice?.reasoning_content ?? undefined,
      model: data.model ?? this.config.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const res = await this.request(messages, { ...opts, stream: true });
    if (!res.ok || !res.body) {
      throw new ProviderError(
        `provider stream failed: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ChatUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { type: "done", usage };
          return;
        }
        try {
          const evt = JSON.parse(payload) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: Array<{ delta?: WireChoiceDelta }>;
          };
          if (evt.usage) {
            usage = {
              promptTokens: evt.usage.prompt_tokens ?? 0,
              completionTokens: evt.usage.completion_tokens ?? 0,
            };
          }
          const delta = evt.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content)
            yield { type: "reasoning", text: delta.reasoning_content };
          if (delta.content) yield { type: "content", text: delta.content };
        } catch {
          // 忽略无法解析的行（心跳、注释等）
        }
      }
    }
    yield { type: "done", usage };
  }

  private request(
    messages: ChatMessage[],
    opts: ChatOptions & { stream: boolean },
  ): Promise<Response> {
    return fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: opts.stream,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
      }),
    });
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}
