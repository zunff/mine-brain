import {
  embedderReady,
  embedderRuntime,
  resolveEmbedder,
  resolveProvider,
} from "@/lib/providers/registry";
import {
  addEntry,
  embeddingsFor,
  getAiSettings,
  getLatestMessageId,
  getSession,
  insertCandidate,
  listCandidates,
  listMemories,
  listMessagesAfter,
  setMemoryEmbedding,
  touchSession,
} from "./repo";
import { type ExtractItem, type MemoryRow, type MessageRow } from "./types";
import { cosine } from "./vector";

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
- 去重：若某条抽取内容与「已有记忆清单」里某条 active 记忆语义相同（同一立场/价值观/纠结，仅措辞稍异），跳过不抽取，避免重复卡；同一主题的最新进展属于演进，用 supersedes 指明被取代的旧记忆 id 关联，而不是新建重复条

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

/* ---------------- 候选去重：提取结果与已有记忆/待确认候选的近似比对 ---------------- */

/** 文本近似度：字符 bigram Dice 系数（中文无空格，bigram 覆盖相邻字符对，对标点/空白/大小写不敏感）。 */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/[\s　\p{P}\p{S}]/gu, "");
    const set = new Set<string>();
    if (t.length <= 1) {
      if (t) set.add(t);
      return set;
    }
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

/** 文本层判重阈值：保守，只杀「几乎同一句」的重复，避免误伤同主题的立场演进。 */
export const DUP_TEXT_THRESHOLD = 0.86;
/** 向量层判重阈值：只认「语义高度雷同、措辞不同」的重复；比文本层更高一档，防止同域短文本的高余弦误杀。 */
const DUP_COSINE_THRESHOLD = 0.95;

/**
 * 文本层同步判重：同批互斥 + 与已有 active 记忆 / 本会话待确认候选的近似比对。
 * 纯函数、零 AI，供单测直接覆盖。
 */
export function isTextDuplicate(
  text: string,
  batchSeen: string[],
  existing: Array<{ content: string }>,
  pending: Array<{ content: string }>,
): boolean {
  const dup = (t: string) => textSimilarity(text, t) >= DUP_TEXT_THRESHOLD;
  if (batchSeen.some(dup)) return true;
  if (pending.some((p) => dup(p.content))) return true;
  if (existing.some((m) => dup(m.content))) return true;
  return false;
}

/** 向量层上下文：embedder 就绪过一次即复用同一批库内向量，逐条项复用。 */
type EmbedCtx =
  | { ready: false }
  | {
      ready: true;
      embed: (texts: string[], opts: { dimensions: number }) => Promise<number[][]>;
      dims: number;
      embs: Array<{ memory_id: number; dims: number; vector: Float32Array }>;
    };

async function isNearDuplicate(
  text: string,
  memories: MemoryRow[],
  pending: Array<{ content: string }>,
  batchSeen: string[],
  embedCtx: EmbedCtx,
): Promise<boolean> {
  // 文本层先判（覆盖 pending 与同批；memories 也必须在此比对——向量只覆盖库里记忆）
  if (isTextDuplicate(text, batchSeen, memories, pending)) return true;
  // 向量层：语义雷同但措辞不同的重复（embed 失败静默降级，绝不影响整理本身）
  if (!embedCtx.ready) return false;
  try {
    const [qvArr] = await embedCtx.embed([text.slice(0, 4000)], { dimensions: embedCtx.dims });
    const qv = new Float32Array(qvArr);
    for (const m of memories) {
      const e = embedCtx.embs.find((x) => x.memory_id === m.id);
      if (e && e.dims === qv.length && cosine(qv, e.vector) >= DUP_COSINE_THRESHOLD) return true;
    }
  } catch {
    /* 向量失败降级到文本层已做的判断 */
  }
  return false;
}

// 单进程内按会话持有整理锁：自动整理（每轮 done 后）与手动整理共用，
// 防止同一批消息被并发抽取两次、各自推进 consolidated_upto 造成重复候选。
const consolidatingSessions = new Set<number>();
export function isConsolidating(sessionId: number): boolean {
  return consolidatingSessions.has(sessionId);
}

/** 某会话是否已「整理追平」：既没有正在进行的整理，最新消息也已被消化。
 * 这是候选落定与否的判定信号——为真时拉候选即为该轮整理的最终结果。 */
export function isConsolidatedUpToDate(sessionId: number): boolean {
  if (isConsolidating(sessionId)) return false;
  const s = getSession(sessionId);
  if (!s) return true;
  const latest = getLatestMessageId(sessionId);
  if (latest == null) return true; // 空会话无从整理
  return s.consolidated_upto >= latest;
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
    // extractor 走非流式 chat 且只需结构化 JSON——对推理模型强制 suppressReasoning（reasoning_effort: none）：
    // 思考会无谓烧掉完成预算，甚至把正文从 max_tokens 里挤掉，导致 JSON 被掐断成半句——
    // 这正是「候选记忆几乎不出现」的根因。关掉思考后，正文预算充足，稳定输出完整 JSON。
    const res = await provider.chat(
      [
        { role: "system", content: "你是严谨的记忆整理员，只输出合法 JSON。" },
        { role: "user", content: buildExtractorPrompt(conversation, digest) },
      ],
      { maxTokens: 4000, temperature: 0.2, suppressReasoning: true },
    );

    const parsed = parseJsonLoose<ExtractResult>(res.content);
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("extractor returned unparseable output");
    }

    const entryId = addEntry("chat", conversation.slice(0, 8000), sessionId);

    // 去重语境：库里 active 记忆 + 本会话待确认候选（跨会话 staging 隔离，不去重其它会话候选）
    const existingMemories = listMemories({ limit: 500 });
    const pendingCandidates = listCandidates({ sessionId, status: "pending", limit: 200 });
    let embedCtx: EmbedCtx = { ready: false };
    if (embedderReady(settings)) {
      try {
        const rt = embedderRuntime(settings);
        const provider = rt ? resolveEmbedder(settings) : null;
        const embed = provider?.embed;
        if (rt && embed) {
          embedCtx = { ready: true, embed, dims: rt.dimensions, embs: embeddingsFor(rt.model) };
        }
      } catch {
        /* 向量不可用则保持纯文本层 */
      }
    }

    const seenInBatch: string[] = [];
    let candidatesAdded = 0;
    let skippedDuplicates = 0;
    for (const item of parsed.items.slice(0, 12)) {
      if (!item.content?.trim()) continue;
      const text = item.content.trim();
      // 显式取代不算重复：extractor 已声明被取代的旧记忆，放手走封口+建边
      if (item.supersedes) {
        seenInBatch.push(text);
        insertCandidate(item, entryId, sessionId);
        candidatesAdded++;
        continue;
      }
      if (await isNearDuplicate(text, existingMemories, pendingCandidates, seenInBatch, embedCtx)) {
        skippedDuplicates++;
        continue;
      }
      seenInBatch.push(text);
      insertCandidate(item, entryId, sessionId);
      candidatesAdded++;
    }
    if (skippedDuplicates > 0) {
      console.log(
        `[consolidate] session ${sessionId}: 跳过 ${skippedDuplicates} 条与已有记忆/候选重复的抽取项`,
      );
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

