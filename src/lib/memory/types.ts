export type MemoryType =
  | "profile"
  | "value"
  | "claim"
  | "decision"
  | "question"
  | "insight"
  | "pattern";

export type MemoryStatus = "active" | "superseded" | "rejected" | "archived";

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
}

export interface MessageRow {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  /** JSON 数组字符串：data URI 图片列表（vision 输入） */
  images: string | null;
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
  question: "开放回路",
  insight: "洞察",
  pattern: "行为模式",
};
