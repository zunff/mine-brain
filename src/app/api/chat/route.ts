import {
  startOrJoinChatStream,
  subscribeExistingChatStream,
  isSessionStreaming,
} from "@/lib/agent/stream-manager";
import type { OrchestratorEvent } from "@/lib/agent/orchestrator";

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
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/chat
 * 启动或加入后台生成流。后台任务常驻执行并持续存库，不随单个 HTTP 连接中断而终止。
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

  const numericSessionId =
    body.sessionId != null && body.sessionId !== "" && !Number.isNaN(Number(body.sessionId))
      ? Number(body.sessionId)
      : null;

  const { sessionId, subscribe } = startOrJoinChatStream(numericSessionId, rawMessage, images, {
    webSearch: body.webSearch === true,
  });

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
