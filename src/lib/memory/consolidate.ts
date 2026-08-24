import {
  embedderReady,
  embedderRuntime,
  resolveEmbedder,
  resolveProvider,
} from "@/lib/providers/registry";
import {
  addEntry,
  getAiSettings,
  getSession,
  insertCandidate,
  listMemories,
  listMessagesAfter,
  setMemoryEmbedding,
  touchSession,
} from "./repo";
import { type ExtractItem, type MessageRow } from "./types";

/**
 * 会话后整理：用 extractor 角色从对话中抽取候选记忆，写入暂存（memory_candidates）。
 * 用户确认后才落正式记忆。失败绝不影响聊天主流程——调用方必须 try/catch 包裹。
 */

interface ExtractResult {
  items: ExtractItem[];
  session_summary?: string;
}

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
- 只有当新记忆明确取代清单里某一条具体旧记忆时才填 supersedes 为该条 id（如新主张直接替换旧主张；某条价值观被明确放弃、换成另一条）。多条价值观并存不构成取代——不要因为「排序变化」就推翻整组价值观
- 与清单里某条矛盾但不构成推翻，把该 id 放进 contradicts 数组
- 情绪强烈的可加 sentiment（-1~1）
- 对话中可能带有【外部资料】（联网检索到的互联网内容）。那是世界的说法，不是用户的经历：绝不把外部观点、新闻或他人言论提取为用户的记忆
- 宁缺毋滥：没有值得记的就返回空数组

对话内容：
<conversation>
${conversation}
</conversation>

只输出 JSON，格式：
{"items":[{"type":"...","title":"...","content":"...","theme":"...","importance":0.5,"sentiment":0,"tags":["..."],"supersedes":null,"contradicts":[]}],"session_summary":"一句话概括这段对话"}`;
}

/** 对话字符预算：一批内的每条消息都必须完整喂给模型，超预算的旧消息留待下批。 */
const BATCH_CHAR_BUDGET = 11000;

/**
 * 从「未整理消息」里按最新优先攒出一个连续批次，直到字符预算用尽。
 * 返回升序、id 连续的切片；consolidated_upto 只推进到本批最大 id，
 * 从而保证超长会话逐批消化，绝不静默跳段。单条超长消息在它成为批次最新时整条纳入。
 */
export function selectFreshBatch(
  unprocessed: MessageRow[],
  charBudget = BATCH_CHAR_BUDGET,
): MessageRow[] {
  const fresh: MessageRow[] = [];
  let budget = charBudget;
  for (let i = unprocessed.length - 1; i >= 0; i--) {
    const m = unprocessed[i];
    const cost = m.content.length + 6; // 「用户/伙伴：」前缀与换行
    if (fresh.length > 0 && cost > budget) break;
    fresh.unshift(m);
    budget -= cost;
  }
  // 批次必须至少含一轮对话（user+assistant），否则整理门槛永远过不了会卡死。
  // 预算不够就向前放宽，把批次起点往前补，宁多勿卡。
  const hasUser = fresh.some((m) => m.role === "user");
  const hasAssistant = fresh.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) {
    for (let i = unprocessed.length - 1 - fresh.length; i >= 0; i--) {
      fresh.unshift(unprocessed[i]);
      if (
        fresh.some((m) => m.role === "user") &&
        fresh.some((m) => m.role === "assistant")
      ) {
        break;
      }
    }
  }
  return fresh;
}

// 单进程内按会话持有整理锁：自动整理（每轮 done 后）与手动整理共用，
// 防止同一批消息被并发抽取两次、各自推进 consolidated_upto 造成重复候选。
const consolidatingSessions = new Set<number>();
export function isConsolidating(sessionId: number): boolean {
  return consolidatingSessions.has(sessionId);
}

/** 抽取并入库。返回新增记忆条数；抛错由调用方兜底。 */
export async function consolidateSession(sessionId: number): Promise<number> {
  if (consolidatingSessions.has(sessionId)) return 0; // 已有整理在进行：跳过本轮（另一请求会推进 upto）
  consolidatingSessions.add(sessionId);
  try {
    const session = getSession(sessionId);
    if (!session) throw new Error(`session ${sessionId} not found`);

    // 只取未整理消息里最近的一批（升序）；批次内部保证完整、连续。
    const fresh = selectFreshBatch(
      listMessagesAfter(sessionId, session.consolidated_upto, 200),
    );
    // 至少一轮完整对话才值得整理；不够就整批留到下次（不推进 upto）
    if (!fresh.some((m) => m.role === "user") || !fresh.some((m) => m.role === "assistant")) {
      return 0;
    }

    const conversation = fresh
      .map((m) => `${m.role === "user" ? "用户" : "伙伴"}：${m.content}`)
      .join("\n\n");

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
    let candidatesAdded = 0;
    for (const item of parsed.items.slice(0, 12)) {
      if (!item.content?.trim()) continue;
      insertCandidate(item, entryId, sessionId);
      candidatesAdded++;
    }

    touchSession(sessionId, {
      consolidatedUpto: Math.max(...fresh.map((m) => m.id)),
      summary: parsed.session_summary?.slice(0, 300) ?? session.summary ?? undefined,
    });

    // 候选入暂存即可，不碰正式 memories；向量化在用户确认后（approveCandidate）再做。
    return candidatesAdded;
  } finally {
    consolidatingSessions.delete(sessionId);
  }
}

/** 把新记忆批量嵌入并按 (model, dims) 存元数据。任何失败都不抛，交给调用方兜底。 */
export async function embedNewMemories(
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

