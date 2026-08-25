import {
  startChatStream,
  subscribeExistingChatStream,
  isSessionStreaming,
} from "@/lib/agent/stream-manager";
import type { OrchestratorEvent } from "@/lib/agent/chat-events";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatBody {
  sessionId?: number | string | null;
  message?: string;
  content?: string;
  /** data URI 图片，最多 4 张（vision） */
  images?: string[];
  /** 用户开启联网：回复前拉取外部资料（未配置搜索 key 时服务端自动忽略） */
  webSearch?: boolean;
  /** 用户开启深度思考：激活多维认知探针与深度推演 */
  deepThinking?: boolean;
  /** 用户开启深度研究：成文前多角度拆解、逐子问题查证记忆与外部资料、对照反例 */
  deepResearch?: boolean;
  /** 编辑消息并重发：从该消息 id 起截断旧问答后再启动生成 */
  replaceFromMessageId?: number;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/chat
 * 启动后台生成流。后台任务常驻执行并持续存库，不随单个 HTTP 连接中断而终止。
 * 若该会话已有活跃流，返回 409 拒绝并发，避免重复消息被静默吞掉。
 */
export async function POST(req: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const rawMessage = (body.message ?? body.content ?? "").trim();
  const images = (body.images ?? []).filter(
    (u) => u.startsWith("data:image/") && u.length < MAX_IMAGE_BYTES,
  );
  if (!rawMessage && images.length === 0) {
    return Response.json({ error: "message required" }, { status: 400 });
  }

  let numericSessionId: number | null = null;
  if (body.sessionId != null && body.sessionId !== "") {
    const n = Number(body.sessionId);
    if (!Number.isInteger(n) || n <= 0) {
      return Response.json({ error: "bad sessionId" }, { status: 400 });
    }
    numericSessionId = n;
  }

  // 编辑重发仅在 stream-manager 排除了并发冲突之后才截断，409 绝不静默删数据。
  let replaceFromMessageId: number | undefined;
  if (body.replaceFromMessageId != null) {
    if (
      numericSessionId == null ||
      !Number.isInteger(body.replaceFromMessageId) ||
      body.replaceFromMessageId <= 0
    ) {
      return Response.json({ error: "bad replaceFromMessageId" }, { status: 400 });
    }
    replaceFromMessageId = body.replaceFromMessageId;
  }

  const result = startChatStream(numericSessionId, rawMessage, images, {
    webSearch: body.webSearch === true,
    deepThinking: body.deepThinking === true,
    deepResearch: body.deepResearch === true,
    ...(replaceFromMessageId != null ? { replaceFromMessageId } : {}),
  });
  if ("conflict" in result) {
    return Response.json(
      { error: "session busy", sessionId: result.sessionId },
      { status: 409 },
    );
  }
  const { sessionId, subscribe } = result;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (evt: OrchestratorEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          if (evt.type === "done") {
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* controller 可能已处于非可写状态 */
        }
      };

      unsubscribe = subscribe(send);

      // 监听客户端主动断开（如关闭网页或切会话）
      req.signal.addEventListener("abort", () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Session-Id": String(sessionId),
      Connection: "keep-alive",
    },
  });
}

/**
 * GET /api/chat?sessionId=123
 * 重新连接已在后台运行中的生成任务。
 * 如果任务还在进行，回放已有全部事件并持续推送新 chunk；如果不存在或已完成，返回 isStreaming: false。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawId = url.searchParams.get("sessionId");
  const sessionId = rawId ? Number(rawId) : NaN;

  if (!Number.isInteger(sessionId) || !isSessionStreaming(sessionId)) {
    return Response.json({ isStreaming: false });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (evt: OrchestratorEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          if (evt.type === "done") {
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      };

      const unsub = subscribeExistingChatStream(sessionId, send);
      if (!unsub) {
        // 已经结束或不存在
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", candidatesAdded: 0 })}\n\n`),
        );
        controller.close();
        return;
      }

      unsubscribe = unsub;

      req.signal.addEventListener("abort", () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Session-Id": String(sessionId),
      Connection: "keep-alive",
    },
  });
}
