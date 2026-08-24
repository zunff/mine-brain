import { runChat, type OrchestratorEvent } from "@/lib/agent/orchestrator";

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (evt: OrchestratorEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };
      try {
        for await (const evt of runChat(numericSessionId, rawMessage, images, {
          webSearch: body.webSearch === true,
        })) {
          send(evt);
        }
      } catch (err) {
        console.error("[chat] failed:", err);
        send({
          type: "content",
          text:
            err instanceof Error && /API key|401|403/i.test(err.message)
              ? "AI 服务鉴权失败。请到「设置」检查 API Key 与模型配置。"
              : `出错了：${err instanceof Error ? err.message : String(err)}`,
        });
        send({ type: "done", candidatesAdded: 0 });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
