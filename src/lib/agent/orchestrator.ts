import { resolveProvider } from "@/lib/providers/registry";
import type { ContentPart } from "@/lib/providers/types";
import { consolidateSession } from "@/lib/memory/consolidate";
import { buildContextBundle } from "@/lib/memory/retrieve";
import {
  addEntry,
  addMessage,
  updateMessageContent,
  createSession,
  getAiSettings,
  getSession,
  listMessages,
  touchSession,
} from "@/lib/memory/repo";
import { buildSystemPrompt } from "./system-prompt";

export type OrchestratorEvent =
  | { type: "meta"; sessionId: number; title: string }
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; memoriesAdded: number };

const HISTORY_LIMIT = 12;

/**
 * 对话主循环：检索 → 组 prompt → 流式回复 → 持久化 → 会话后整理。
 * 整理失败只记日志，绝不影响回复已送达的事实。
 */
export async function* runChat(
  sessionId: number | null,
  userText: string,
  images?: string[],
): AsyncGenerator<OrchestratorEvent> {
  const trimmed = userText.trim();
  if (!trimmed && !(images && images.length > 0)) throw new Error("empty message");

  let session = sessionId ? getSession(sessionId) : null;
  if (!session) {
    session = createSession(deriveTitle(trimmed || "（图片）"));
  }
  yield { type: "meta", sessionId: session.id, title: session.title };

  addMessage(session.id, "user", trimmed, undefined, images);
  addEntry("chat", trimmed || `（发送了 ${images?.length ?? 0} 张图片）`, session.id);
  if (session.title === "新对话") {
    touchSession(session.id, { title: deriveTitle(trimmed || "图片对话") });
  }

  const bundle = buildContextBundle(trimmed);
  const history = listMessages(session.id, HISTORY_LIMIT).slice(0, -1); // 去掉刚插入的这条
  const settings = getAiSettings();
  const provider = resolveProvider(settings, "thinker");

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(bundle) },
    ...history.map((m) => ({ role: m.role, content: rebuildContent(m) })),
    { role: "user" as const, content: buildUserContent(trimmed, images) },
  ];

  let content = "";
  // 流式期间节流落库：中途刷新/断流不丢整条回复
  const { id: draftId } = addMessage(session.id, "assistant", "");
  let lastFlush = Date.now();
  const flush = () => {
    updateMessageContent(draftId, content, reasoning || null);
    lastFlush = Date.now();
  };

  let reasoning = "";
  for await (const chunk of provider.chatStream(messages, {
    maxTokens: 4096,
    temperature: 0.7,
  })) {
    if (chunk.type === "content") {
      content += chunk.text;
      yield chunk;
    } else if (chunk.type === "reasoning") {
      reasoning += chunk.text;
      yield chunk;
    }
    if (Date.now() - lastFlush > 1200) flush();
  }
  flush(); // 收尾强制刷一次

  if (!content.trim()) {
    content = "（模型这次没有返回正文，请重试或到设置页检查 AI 配置。）";
    updateMessageContent(draftId, content, reasoning || null);
    yield { type: "content", text: content };
  }

  let memoriesAdded = 0;
  try {
    memoriesAdded = await consolidateSession(session.id);
  } catch (err) {
    console.error("[consolidate] failed:", err);
  }

  yield { type: "done", memoriesAdded };
}

function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 18 ? clean : clean.slice(0, 18) + "…";
}

/** 历史消息重建：带图的消息还原为 vision multipart 格式。 */
function rebuildContent(m: { role: string; content: string; images: string | null }): string | ContentPart[] {
  if (!m.images) return m.content;
  try {
    const urls = JSON.parse(m.images) as string[];
    return buildUserContent(m.content, urls);
  } catch {
    return m.content;
  }
}

function buildUserContent(
  text: string,
  images?: string[],
): string | ContentPart[] {
  if (!images || images.length === 0) return text;
  const parts: ContentPart[] = [];
  // 文字在前、图在后：部分推理模型在长 system 提示下图先文后会出现视觉注意力退化
  if (text.trim()) parts.push({ type: "text", text });
  for (const url of images.slice(0, 4)) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}
