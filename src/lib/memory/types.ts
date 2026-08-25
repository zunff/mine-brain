export type MemoryType =
  | "profile"
  | "value"
  | "claim"
  | "decision"
  | "question"
  | "insight"
  | "pattern";

export type MemoryStatus = "active" | "superseded" | "rejected" | "archived";

/** 运行时校验用的合法值集（API 入参、LLM 输出都可能带非法值，不能只靠 TS 类型）。 */
export const MEMORY_TYPES: readonly MemoryType[] = [
  "profile",
  "value",
  "claim",
  "decision",
  "question",
  "insight",
  "pattern",
];

export const MEMORY_STATUSES: readonly MemoryStatus[] = [
  "active",
  "superseded",
  "rejected",
  "archived",
];

/** 记忆候选的状态：整理产出先入暂存（pending），用户确认后 approved、拒绝则 rejected。 */
export type CandidateStatus = "pending" | "approved" | "rejected";

/** 立场类记忆（profile/value/claim/decision）才能取代旧记忆；观察类（question/insight/pattern）只能质疑。
 * 真实 bug 回归锚点：观察类记忆曾被误标为推翻价值陈述。 */
export function canSupersede(type: MemoryType): boolean {
  return type === "profile" || type === "value" || type === "claim" || type === "decision";
}

/** extractor 输出的单条抽取项（LLM 原始输出的宽松形态，字段可能不是预期类型）。 */
export interface ExtractItem {
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

export type LinkRel =
  | "supports"
  | "contradicts"
  | "supersedes"
  | "causes"
  | "instance_of"
  | "related_to"
  | "during";

export interface MemoryRow {
  id: number;
  type: MemoryType;
  title: string;
  content: string;
  status: MemoryStatus;
  importance: number;
  theme: string | null;
  sentiment: number | null;
  valid_from: string | null;
  valid_to: string | null;
  source_entry_id: number | null;
  session_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SessionRow {
  id: number;
  title: string;
  summary: string | null;
  consolidated_upto: number;
  created_at: string;
  updated_at: string;
  /** 消息条数（列表接口附带，用于「空对话」判断）。 */
  message_count?: number;
}

export interface MessageRow {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  /** JSON 数组字符串：data URI 图片列表（vision 输入） */
  images: string | null;
  /** JSON 数组字符串：联网参考的外部资料 */
  web_sources?: string | null;
  /** JSON 对象字符串：本轮调取的记忆与生活域 */
  retrieved_memories?: string | null;
  created_at: string;
}

/** 生活域分类（theme）。保持小而稳定，检索与矛盾对照都依赖它。 */
export const THEMES = [
  "career",
  "relationship",
  "family",
  "health",
  "money",
  "growth",
  "meaning",
  "self",
] as const;

export const THEME_LABELS: Record<(typeof THEMES)[number], string> = {
  career: "事业",
  relationship: "关系",
  family: "家庭",
  health: "健康",
  money: "金钱",
  growth: "成长",
  meaning: "意义",
  self: "自我",
};

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  profile: "关于我",
  value: "价值观",
  claim: "主张",
  decision: "决定",
  question: "未解心结",
  insight: "洞察",
  pattern: "行为模式",
};
