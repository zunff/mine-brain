import {
  embeddingsFor,
  listMemories,
  linksFor,
  tagsByMemoryIds,
} from "./repo";
import { MemoryRow, THEMES } from "./types";
import { embedderReady, embedderRuntime, resolveEmbedder, type AiSettings } from "@/lib/providers/registry";
import { vectorBoost } from "./vector";

/**
 * 检索哲学：服务于深度思考，不是相似度匹配。
 * 多信号 = 标签命中 + 生活域命中 + 时近 + 重要性 +（可选）向量余弦；
 * 矛盾与开放回路单独专项检索。向量只对一个模型生效（跨模型是噪音）。
 */

export interface ContextBundle {
  /** 宪章切面：关于我 + 价值观，几乎每次都带 */
  constitution: MemoryRow[];
  /** 与本次话题相关的记忆 */
  related: MemoryRow[];
  /** 张力：与相关记忆存在 contradicts/supersedes 关系的另一端 + 同域旧决定 */
  tensions: MemoryRow[];
  /** 开放回路：同域未解的反复纠结 */
  openLoops: MemoryRow[];
  /** 本次命中的生活域 */
  themes: string[];
}

export interface RetrievalOpts {
  /** 第 5 条信号：记忆 id → 余弦得分映射（由调用方按当前 embedding 模型预计算）。 */
  vectorBoostById?: Map<number, number>;
}

const THEME_KEYWORDS: Record<string, string[]> = {
  career: ["工作", "职业", "公司", "离职", "跳槽", "升职", "项目", "老板", "同事", "面试", "加班", "事业"],
  relationship: ["朋友", "恋爱", "伴侣", "分手", "约会", "感情", "对象"],
  family: ["父母", "家", "妈妈", "爸爸", "孩子", "结婚", "亲戚", "家人"],
  health: ["健康", "睡觉", "失眠", "运动", "健身", "生病", "焦虑", "情绪", "累", "抑郁"],
  money: ["钱", "存款", "工资", "消费", "买房", "投资", "理财", "负债"],
  growth: ["学习", "读书", "课程", "习惯", "成长", "练习", "技能"],
  meaning: ["意义", "价值", "目标", "人生", "幸福", "迷茫", "意义感"],
  self: ["我", "自己", "性格", "拖延", "自律", "自信", "内耗"],
};

/** 从用户消息中提取检索信号：标签词命中 + 生活域判定。不依赖分词器。 */
export function extractSignals(
  message: string,
  vocabulary: string[],
): { tags: string[]; themes: string[] } {
  const lower = message.toLowerCase();
  const tags = vocabulary.filter((t) => t.length >= 2 && lower.includes(t));
  const themes = THEMES.filter((th) =>
    (THEME_KEYWORDS[th] ?? []).some((kw) => message.includes(kw)),
  ).map(String);
  return { tags, themes };
}

function recencyBoost(isoDate: string | null, now: Date): number {
  if (!isoDate) return 0;
  const days = (now.getTime() - new Date(isoDate).getTime()) / 86400000;
  if (days <= 0) return 1.5;
  if (days >= 30) return 0;
  return 1.5 * (1 - days / 30);
}

export function buildContextBundle(message: string, opts: RetrievalOpts = {}): ContextBundle {
  const all = listMemories({ limit: 2000 });
  const tagMap = tagsByMemoryIds(all.map((m) => m.id));
  const vocab = [...new Set([...tagMap.values()].flat())];
  const { tags, themes } = extractSignals(message, vocab);
  const now = new Date();
  const tagSet = new Set(tags);
  const themeSet = new Set(themes);

  const constitution = all
    .filter((m) => (m.type === "profile" || m.type === "value") && m.status === "active")
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);

  const scored = all
    .filter((m) => m.status === "active" && !constitution.includes(m))
    .map((m) => {
      const mtags = tagMap.get(m.id) ?? [];
      const tagHits = mtags.filter((t) => tagSet.has(t)).length;
      let score =
        tagHits * 3 +
        (m.theme && themeSet.has(m.theme) ? 2.5 : 0) +
        recencyBoost(m.created_at, now) +
        m.importance * 2 +
        (opts.vectorBoostById?.get(m.id) ?? 0);
      if (m.type === "decision" || m.type === "question") score += 0.5;
      return { m, score };
    })
    .filter((x) => x.score > 1.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // 无命中时兜底：最重要的近期记忆，保证伙伴始终有落点
  const fallback =
    scored.length === 0
      ? all
          .filter((m) => m.status === "active" && !constitution.includes(m))
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 4)
      : scored.map((x) => x.m);

  const related = fallback;

  // 张力专项：沿 contradicts / supersedes 边拉出对端记忆
  const linkMap = linksFor(related.map((m) => m.id));
  const tensionIds = new Set<number>();
  for (const [, edges] of linkMap) {
    for (const e of edges) {
      if (e.rel !== "contradicts" && e.rel !== "supersedes") continue;
      const other = related.some((r) => r.id === e.from_id) ? e.to_id : e.from_id;
      tensionIds.add(other);
    }
  }
  const byId = new Map(all.map((m) => [m.id, m]));
  const tensions = [...tensionIds]
    .map((id) => byId.get(id))
    .filter((m): m is MemoryRow => !!m)
    .slice(0, 5);

  // 开放回路专项：命中域里仍未解的纠结
  const openLoops = all
    .filter(
      (m) =>
        m.status === "active" &&
        m.type === "question" &&
        !related.includes(m) &&
        (!m.theme || themeSet.size === 0 || themeSet.has(m.theme)),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);

  return { constitution, related, tensions, openLoops, themes };
}

/**
 * 第 5 条信号预计算：把用户消息向量化，再与当前 embedding 模型下的全部记忆向量求余弦。
 * 失败（无 key / 接口异常 / 向量维度不匹配）一律返回 null，调用方降级到词法信号。
 * 只对当前离线模型生效：切换 embedding 模型后旧向量自动失效，需重嵌。
 */
let embedCooldownUntil = 0;

export async function computeVectorBoostMap(
  settings: AiSettings,
  queryText: string,
): Promise<Map<number, number> | null> {
  if (!embedderReady(settings)) return null;
  if (Date.now() < embedCooldownUntil) return null; // 熔断：短时间内失败过就跳过
  const rt = embedderRuntime(settings);
  if (!rt) return null;
  try {
    const provider = resolveEmbedder(settings);
    if (!provider?.embed) return null;
    const [qvArr] = await provider.embed([queryText.slice(0, 4000)], {
      dimensions: rt.dimensions,
    });
    const qv = new Float32Array(qvArr);
    const boost = new Map<number, number>();
    for (const e of embeddingsFor(rt.model)) {
      if (e.dims !== qv.length) continue; // 维度不同 = 非同一空间，跳过
      const b = vectorBoost(qv, e.vector);
      if (b > 0.4) boost.set(e.memory_id, b);
    }
    return boost;
  } catch (err) {
    console.error("[embed] skipped:", err);
    embedCooldownUntil = Date.now() + 5 * 60 * 1000;
    return null;
  }
}
