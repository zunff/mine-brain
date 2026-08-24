import { resolveProvider, resolveSearcher, searcherReady } from "@/lib/providers/registry";
import {
  gatherWebMaterial,
  type WebMaterial,
  type WebSource,
} from "@/lib/providers/web-search";
import type { ContentPart } from "@/lib/providers/types";
import { consolidateSession } from "@/lib/memory/consolidate";
import { buildContextBundle, computeVectorBoostMap } from "@/lib/memory/retrieve";
import { getAssistantPreferences } from "@/lib/memory/onboarding";
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

export interface RetrievedMemorySummary {
  id: number;
  title: string;
  type: string;
  theme?: string | null;
  content: string;
  relation: "constitution" | "related" | "tension" | "openLoop";
}

export type OrchestratorEvent =
  | { type: "meta"; sessionId: number; title: string }
  | { type: "status"; text: string }
  | { type: "context"; themes: string[]; memories: RetrievedMemorySummary[] }
  | { type: "web"; mode: "read" | "search"; sources: WebSource[] }
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; candidatesAdded: number };

const HISTORY_LIMIT = 12;

export interface RunChatOptions {
  /** 用户开启「联网」：回复前拉取外部资料注入上下文。未配 key 或失败时静默跳过。 */
  webSearch?: boolean;
}

/**
 * 对话主循环：检索（+可选联网）→ 组 prompt → 流式回复 → 持久化 → 会话后整理。
 * 整理失败只记日志，绝不影响回复已送达的事实。
 */
export async function* runChat(
  sessionId: number | null,
  userText: string,
  images?: string[],
  opts: RunChatOptions = {},
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

  yield { type: "status", text: "正在调取历史记忆与价值观..." };

  const settings = getAiSettings();
  const vectorBoostById = await computeVectorBoostMap(settings, trimmed);
  const bundle = buildContextBundle(trimmed, { vectorBoostById: vectorBoostById ?? undefined });

  // 记忆检索摘要：向前端透出本次调取的记忆切面（张力、开放回路、相关记忆与宪章）
  const memorySummaries: RetrievedMemorySummary[] = [];
  const seenIds = new Set<number>();
  for (const m of bundle.tensions.slice(0, 2)) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      memorySummaries.push({
        id: m.id,
        title: m.title || m.content.slice(0, 24),
        type: m.type,
        theme: m.theme,
        content: m.content,
        relation: "tension",
      });
    }
  }
  for (const m of bundle.openLoops.slice(0, 2)) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      memorySummaries.push({
        id: m.id,
        title: m.title || m.content.slice(0, 24),
        type: m.type,
        theme: m.theme,
        content: m.content,
        relation: "openLoop",
      });
    }
  }
  for (const m of bundle.related.slice(0, 3)) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      memorySummaries.push({
        id: m.id,
        title: m.title || m.content.slice(0, 24),
        type: m.type,
        theme: m.theme,
        content: m.content,
        relation: "related",
      });
    }
  }
  for (const m of bundle.constitution.slice(0, 2)) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      memorySummaries.push({
        id: m.id,
        title: m.title || m.content.slice(0, 24),
        type: m.type,
        theme: m.theme,
        content: m.content,
        relation: "constitution",
      });
    }
  }

  if (memorySummaries.length > 0 || bundle.themes.length > 0) {
    yield {
      type: "context",
      themes: bundle.themes,
      memories: memorySummaries,
    };
  }

  // 联网支线：开了开关且配了专属 key 才走；任何失败都只记日志——
  // 外部资料是锦上添花，绝不能挡住回复本身（与 embedder 降级同款纪律）。
  let web: WebMaterial | null = null;
  if (opts.webSearch && trimmed && searcherReady(settings)) {
    const searcher = resolveSearcher(settings);
    if (searcher) {
      yield { type: "status", text: "正在联网检索外部实时资料..." };
      try {
        const material = await gatherWebMaterial(searcher, trimmed);
        if (material.sources.length > 0) {
          web = { mode: material.mode, sources: material.sources };
          yield {
            type: "web",
            mode: web.mode,
            // 只给 UI 需要的字段：正文留给 prompt，不进事件流
            sources: web.sources.map(({ title, url, publishedDate }) => ({
              title,
              url,
              publishedDate,
            })),
          };
        }
      } catch (err) {
        console.error("[web] skipped:", err);
      }
    }
  }

  yield { type: "status", text: "正在深度思考与对照..." };

  const serializedMemories =
    memorySummaries.length > 0 || bundle.themes.length > 0
      ? JSON.stringify({ themes: bundle.themes, memories: memorySummaries })
      : null;

  const serializedWebSources =
    web && web.sources.length > 0
      ? JSON.stringify(
          web.sources.map(({ title, url, publishedDate }) => ({
            title,
            url,
            publishedDate,
          }))
        )
      : null;

  const history = listMessages(session.id, HISTORY_LIMIT).slice(0, -1); // 去掉刚插入的这条
  const provider = resolveProvider(settings, "thinker");

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(bundle, getAssistantPreferences(), web),
    },
    ...history.map((m) => ({ role: m.role, content: rebuildContent(m) })),
    { role: "user" as const, content: buildUserContent(trimmed, images) },
  ];

  let content = "";
  // 流式期间节流落库：中途刷新/断流不丢整条回复，同时持久化当轮调取的记忆与外部资料
  const { id: draftId } = addMessage(
    session.id,
    "assistant",
    "",
    undefined,
    undefined,
    serializedWebSources ?? undefined,
    serializedMemories ?? undefined
  );
  let lastFlush = Date.now();
  const flush = () => {
    updateMessageContent(draftId, content, reasoning || null, {
      webSources: serializedWebSources,
      retrievedMemories: serializedMemories,
    });
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

  // 会话后记忆提炼异步进行，绝不阻塞回复流关闭（避免前端在正文结束后卡顿挂起 5~10 秒）
  void consolidateSession(session.id).catch((err) => {
    console.error("[consolidate] background failed:", err);
  });

  yield { type: "done", candidatesAdded: 0 };
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
