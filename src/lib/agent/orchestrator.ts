import { resolveProvider, resolveSearcher, searcherReady } from "@/lib/providers/registry";
import { gatherWebMaterial, type WebMaterial } from "@/lib/providers/web-search";
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
  listReferencedMemoryIds,
  touchSession,
} from "@/lib/memory/repo";
import { buildSystemPrompt } from "./system-prompt";
import {
  researchStepToTrace,
  runResearchPhase,
  stepToPanelStep,
  type ResearchBrief,
} from "./research";
import type {
  OrchestratorEvent,
  RetrievedMemorySummary,
  RetrievalTrace,
} from "./chat-events";

const HISTORY_LIMIT = 12;

export interface RunChatOptions {
  /** 用户开启「联网」：回复前拉取外部资料注入上下文。未配 key 或失败时静默跳过。 */
  webSearch?: boolean;
  /** 用户开启「深度思考」：激活多维度认知探针、时间线回溯与高强度长程推理。 */
  deepThinking?: boolean;
  /** 用户开启「深度研究」：成文前多角度拆解、逐子问题查证记忆与外部资料、对照反例。 */
  deepResearch?: boolean;
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
  const userMsg = addMessage(session.id, "user", trimmed, undefined, images);
  addEntry("chat", trimmed || `（发送了 ${images?.length ?? 0} 张图片）`, session.id);
  if (session.title === "新对话") {
    touchSession(session.id, { title: deriveTitle(trimmed || "图片对话") });
  }
  yield {
    type: "meta",
    sessionId: session.id,
    title: session.title,
    userMessageId: userMsg.id,
  };

  yield { type: "status", text: "正在调取历史记忆与价值观..." };

  const settings = getAiSettings();
  const vectorBoostById = await computeVectorBoostMap(settings, trimmed);

  // 会话内去重：本会话已引用过的记忆 id 不再重复注入（宪章除外，见 retrieve.ts）。
  // 扫整个会话而非最近 12 条——历史引用与模型上下文是两个不同的问题。
  const citedIds = new Set(listReferencedMemoryIds(session.id));

  const bundle = buildContextBundle(trimmed, {
    vectorBoostById: vectorBoostById ?? undefined,
    deepThinking: opts.deepThinking === true,
    excludeIds: [...citedIds],
  });

  // 本轮检索依据：只描述实际调取到了什么，不声称"调用了工具"。
  const traces: RetrievalTrace[] = [];

  // 1. 核心记忆探针
  const memCount = bundle.constitution.length + bundle.related.length;
  const memTrace: RetrievalTrace = {
    id: "trace_mem",
    name: "核心宪章与相关记忆探查",
    description: `检索到 ${bundle.constitution.length} 条长期画像/价值观与 ${bundle.related.length} 条相关主张`,
    count: memCount,
    details: [...bundle.constitution, ...bundle.related]
      .slice(0, 5)
      .map((m) => m.title || m.content.slice(0, 24)),
  };
  traces.push(memTrace);
  yield { type: "trace", trace: memTrace };

  // 2. 矛盾张力探针
  if (bundle.tensions.length > 0) {
    const tensionTrace: RetrievalTrace = {
      id: "trace_tension",
      name: "历史矛盾与对立面比对",
      description: `沿矛盾与推翻边线索交叉比对出 ${bundle.tensions.length} 条对立观点`,
      count: bundle.tensions.length,
      details: bundle.tensions.map((m) => m.title || m.content.slice(0, 24)),
    };
    traces.push(tensionTrace);
    yield { type: "trace", trace: tensionTrace };
  }

  // 3. 时间线 / 纠结回路探针
  const timelineCount = (bundle.timeline?.length ?? 0) + bundle.openLoops.length;
  if (timelineCount > 0) {
    const timelineTrace: RetrievalTrace = {
      id: "trace_timeline",
      name: "信念演进与未解纠结溯源",
      description: `回溯了 ${bundle.openLoops.length} 条反复出现的纠结回路与 ${bundle.timeline?.length ?? 0} 条时间线主张`,
      count: timelineCount,
      details: [...bundle.openLoops, ...(bundle.timeline ?? [])]
        .slice(0, 5)
        .map((m) => m.title || m.content.slice(0, 24)),
    };
    traces.push(timelineTrace);
    yield { type: "trace", trace: timelineTrace };
  }

  // 记忆检索摘要：向前端透出本次调取的记忆切面（张力、开放回路、时间线、相关记忆与宪章）
  const memorySummaries: RetrievedMemorySummary[] = [];
  const seenIds = new Set<number>();
  for (const m of bundle.tensions.slice(0, 3)) {
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
  for (const m of (bundle.timeline ?? []).slice(0, 3)) {
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      memorySummaries.push({
        id: m.id,
        title: m.title || m.content.slice(0, 24),
        type: m.type,
        theme: m.theme,
        content: m.content,
        relation: "timeline",
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

  if (memorySummaries.length > 0 || bundle.themes.length > 0 || traces.length > 0) {
    yield {
      type: "context",
      themes: bundle.themes,
      memories: memorySummaries,
      traces,
      deepThinking: opts.deepThinking === true,
      deepResearch: opts.deepResearch === true,
    };
  }

  // 深度研究：同一管道上的前置查证阶段（规划→逐子问题查证→汇成【研究纪要】）。
  // 只读、有界、可降级；web 由研究阶段自理，因此开了深度研究就跳过下面的普通联网支线。
  let research: ResearchBrief | null = null;
  if (opts.deepResearch) {
    const researchHistory = listMessages(session.id, 6)
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "用户" : "伙伴"}：${m.content.slice(0, 200)}`);
    const memoryDigest = [...bundle.constitution, ...bundle.related]
      .slice(0, 16)
      .map((m) => `${m.type}「${m.title || m.content.slice(0, 24)}」：${m.content.slice(0, 120)}`)
      .join("\n");
    research = yield* runResearchPhase({
      settings,
      question: trimmed,
      memoryDigest,
      history: researchHistory,
    });
    // 研究步骤 trace 并入序列化：重载后探索明细里的查证卡片不丢（与联网/记忆同口径持久化）
    if (research) {
      for (const step of research.steps) traces.push(researchStepToTrace(step));
    }
  }

  // 联网支线：开了开关且配了专属 key 才走；任何失败都只记日志——
  // 外部资料是锦上添花，绝不能挡住回复本身（与 embedder 降级同款纪律）。
  let web: WebMaterial | null = null;
  if (opts.webSearch && !opts.deepResearch && trimmed && searcherReady(settings)) {
    const searcher = resolveSearcher(settings);
    if (searcher) {
      yield { type: "status", text: "正在联网检索外部实时资料..." };
      try {
        const material = await gatherWebMaterial(searcher, trimmed);
        if (material.sources.length > 0) {
          web = { mode: material.mode, sources: material.sources };
          const webTrace: RetrievalTrace = {
            id: "trace_web",
            name: "外部事实与实时资料校准",
            description: `从公共互联网检索到 ${web.sources.length} 篇相关资料`,
            count: web.sources.length,
            details: web.sources.map((s) => s.title),
          };
          traces.push(webTrace);
          yield { type: "trace", trace: webTrace };
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

  yield {
    type: "status",
    text: opts.deepThinking
      ? "多维认知探针已就绪，正在进行深度推演..."
      : opts.deepResearch
        ? "研究纪要已就绪，正在综合成文..."
        : "正在思考与对照...",
  };

  const researchPanelSteps = research?.steps.map(stepToPanelStep);
  const serializedMemories =
    memorySummaries.length > 0 || bundle.themes.length > 0 || traces.length > 0
      ? JSON.stringify({
          themes: bundle.themes,
          memories: memorySummaries,
          traces,
          deepThinking: opts.deepThinking === true,
          deepResearch: opts.deepResearch === true,
          ...(researchPanelSteps && researchPanelSteps.length > 0
            ? { research: researchPanelSteps }
            : {}),
        })
      : null;

  const serializedWebSources =
    web && web.sources.length > 0
      ? JSON.stringify(
          web.sources.map(({ title, url, publishedDate }) => ({
            title,
            url,
            publishedDate,
          })),
        )
      : null;

  const history = listMessages(session.id, HISTORY_LIMIT).slice(0, -1); // 去掉刚插入的这条
  const provider = resolveProvider(settings, "thinker");

  const messages = [
    {
      role: "system" as const,
      content: buildSystemPrompt(
        bundle,
        getAssistantPreferences(),
        web,
        opts.deepThinking === true,
        research,
      ),
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
    serializedMemories ?? undefined,
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
  const maxTokens = opts.deepThinking || opts.deepResearch ? 8192 : 4096;
  for await (const chunk of provider.chatStream(messages, {
    maxTokens,
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
