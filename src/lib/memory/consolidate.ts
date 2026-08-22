import {
  embedderReady,
  embedderRuntime,
  resolveEmbedder,
  resolveProvider,
} from "@/lib/providers/registry";
import { getAiSettings } from "./repo";
import {
  addEntry,
  getMemory,
  getSession,
  insertMemory,
  linkMemories,
  listMemories,
  listMessages,
  setMemoryEmbedding,
  setTags,
  supersedeMemory,
  touchSession,
} from "./repo";
import { THEMES, type MemoryType } from "./types";

/**
 * 会话后整理：用 extractor 角色从对话中抽取结构化记忆。
 * 失败绝不影响聊天主流程——调用方必须 try/catch 包裹。
 */

interface ExtractItem {
  type?: string;
  title?: string;
  content?: string;
  theme?: string;
  importance?: number;
  sentiment?: number;
  tags?: string[];
  supersedes?: number | null;
  contradicts?: number[];
}

interface ExtractResult {
  items: ExtractItem[];
  session_summary?: string;
}

const VALID_TYPES: MemoryType[] = [
  "profile",
  "value",
  "claim",
  "decision",
  "question",
  "insight",
  "pattern",
];

function buildExtractorPrompt(
  conversation: string,
  existingDigest: string,
): string {
  return `你在为一个人的「第二大脑」做记忆整理。下面是他与思考伙伴的一段对话，以及他已有的长期记忆清单。

任务：从对话中抽取值得长期记住的关于「他本人」的记忆。只提取真实出现的内容，禁止编造或过度推断。

已有记忆清单（id | 类型 | 内容摘要）：
${existingDigest || "（空）"}

抽取规则：
- type 取值：profile(关于我)/value(价值观)/claim(主张·信念)/decision(决定)/question(反复纠结的开放回路)/insight(洞察)/pattern(行为模式)
- content 用第一人称写（如"我……"），具体、可追溯，避免空话
- theme 取值：career/relationship/family/health/money/growth/meaning/self，不确定就填 self
- importance 0~1：日常吐槽 0.3 左右，重要决定与核心价值观 0.8+
- tags：2~5 个检索用关键词
- 如果新记忆明确推翻了清单里某条旧记忆，填 supersedes 为该条 id；价值观排序变化也算推翻（如「现在稳定比成长重要」推翻旧的价值排序），填旧 value 记忆的 id
- 与清单里某条矛盾但不构成推翻，把该 id 放进 contradicts 数组
- 情绪强烈的可加 sentiment（-1~1）
- 宁缺毋滥：没有值得记的就返回空数组

对话内容：
<conversation>
${conversation}
</conversation>

只输出 JSON，格式：
{"items":[{"type":"...","title":"...","content":"...","theme":"...","importance":0.5,"sentiment":0,"tags":["..."],"supersedes":null,"contradicts":[]}],"session_summary":"一句话概括这段对话"}`;
}

/**
 * 语义守卫：只有立场类记忆能取代旧记忆（supersede）；
 * 观察类（question/insight/pattern）「质疑」不等于「取代」——
 * 模型误填 supersedes 时由调用方降级为 related_to 边。
 * 这是真实 bug 的回归锚点：开放回路曾把价值陈述错误标记为已推翻。
 */
export function canSupersede(type: MemoryType): boolean {
  const STANCE_TYPES: MemoryType[] = ["profile", "value", "claim", "decision"];
  return STANCE_TYPES.includes(type);
}

/** 抽取并入库。返回新增记忆条数；抛错由调用方兜底。 */
export async function consolidateSession(sessionId: number): Promise<number> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`session ${sessionId} not found`);

  const messages = listMessages(sessionId);
  const fresh = messages.filter((m) => m.id > session.consolidated_upto);
  // 至少一轮完整对话才值得整理
  if (!fresh.some((m) => m.role === "user") || !fresh.some((m) => m.role === "assistant")) {
    return 0;
  }

  const conversation = fresh
    .map((m) => `${m.role === "user" ? "用户" : "伙伴"}：${m.content}`)
    .join("\n\n")
    .slice(0, 12000);

  const digest = listMemories({ limit: 60 })
    .map((m) => `${m.id} | ${m.type} | ${(m.title || m.content).slice(0, 70)}`)
    .join("\n");

  const settings = getAiSettings();
  const provider = resolveProvider(settings, "extractor");
  const res = await provider.chat(
    [
      { role: "system", content: "你是严谨的记忆整理员，只输出合法 JSON。" },
      { role: "user", content: buildExtractorPrompt(conversation, digest) },
    ],
    { maxTokens: 4000, temperature: 0.2 },
  );

  const parsed = parseJsonLoose<ExtractResult>(res.content);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("extractor returned unparseable output");
  }

  const entryId = addEntry("chat", conversation.slice(0, 8000), sessionId);
  let inserted = 0;
  const newMemories: Array<{ id: number; content: string }> = [];

  for (const item of parsed.items.slice(0, 12)) {
    if (!item.content?.trim()) continue;
    const type = VALID_TYPES.includes(item.type as MemoryType)
      ? (item.type as MemoryType)
      : "claim";
    const theme =
      item.theme && (THEMES as readonly string[]).includes(item.theme)
        ? item.theme
        : "self";
    const memoryId = insertMemory({
      type,
      title: (item.title ?? "").slice(0, 80),
      content: item.content.trim().slice(0, 2000),
      importance: clampNum(item.importance, 0, 1, 0.5),
      sentiment:
        item.sentiment == null ? null : clampNum(item.sentiment, -1, 1, 0),
      theme,
      sourceEntryId: entryId,
      sessionId,
    });
    inserted++;
    newMemories.push({ id: memoryId, content: item.content.trim().slice(0, 2000) });
    setTags(memoryId, Array.isArray(item.tags) ? item.tags.map(String) : []);

    // 领域规则：价值观是单一演进的排名——新 value 入库时，旧的 active value
    // 一律封口为 superseded 并连边（模型漏填 supersedes 时兜底）。
    let supersededAny = false;
    for (const old of listMemories({ type: "value", limit: 50 })) {
      if (old.id === memoryId) continue;
      supersedeMemory(old.id, memoryId);
      supersededAny = true;
    }

    if (!supersededAny && item.supersedes && getMemory(Number(item.supersedes))) {
      const targetId = Number(item.supersedes);
      if (canSupersede(type)) {
        supersedeMemory(targetId, memoryId);
      } else {
        linkMemories(memoryId, targetId, "related_to", "观察类记忆的模型误填，已降级");
      }
    }
    for (const cid of (item.contradicts ?? []).slice(0, 3)) {
      if (getMemory(Number(cid))) linkMemories(memoryId, Number(cid), "contradicts");
    }
  }

  touchSession(sessionId, {
    consolidatedUpto: Math.max(...fresh.map((m) => m.id)),
    summary: parsed.session_summary?.slice(0, 300) ?? session.summary ?? undefined,
  });

  // 向量化新记忆：失败不影响整理成功，签名后静默降级（无向量 → 检索走词法信号）。
  await embedNewMemories(settings, newMemories);
  return inserted;
}

/** 把新记忆批量嵌入并按 (model, dims) 存元数据。任何失败都不抛，交给调用方兜底。 */
async function embedNewMemories(
  settings: ReturnType<typeof getAiSettings>,
  memories: Array<{ id: number; content: string }>,
): Promise<void> {
  if (memories.length === 0 || !embedderReady(settings)) return;
  const rt = embedderRuntime(settings);
  if (!rt) return;
  try {
    const provider = resolveEmbedder(settings);
    if (!provider?.embed) return;
    const vectors = await provider.embed(
      memories.map((m) => m.content.slice(0, 4000)),
      { dimensions: rt.dimensions },
    );
    for (let i = 0; i < memories.length; i++) {
      const v = vectors[i];
      if (!v) continue;
      setMemoryEmbedding(memories[i].id, rt.model, v.length, new Float32Array(v));
    }
  } catch (err) {
    console.error("[embed-new] skipped:", err);
  }
}

/** 容错 JSON 解析：剥掉代码围栏、截取首尾大括号之间内容。 */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
