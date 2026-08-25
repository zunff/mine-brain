import { readAiEnvConfig } from "@/lib/config";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { ExaWebProvider, type WebSearchProvider } from "./web-search";
import { AgentRole, AIProvider, ProviderConfig, RoleOverride } from "./types";

/** 设置页存储的完整 AI 配置（DB settings 表 key="ai"，JSON）。 */
export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  roles?: Partial<Record<AgentRole, RoleOverride>>;
}

export function resolveProvider(settings: AiSettings, role: AgentRole): AIProvider {
  const o = settings.roles?.[role];
  const cfg: ProviderConfig = {
    baseUrl: o?.baseUrl?.trim() || settings.baseUrl,
    apiKey: o?.apiKey?.trim() || settings.apiKey,
    model: o?.model?.trim() || settings.model,
  };
  return new OpenAICompatibleProvider(cfg);
}

/** embedder 的有效运行时配置（角色覆盖优先，其次环境默认）。 */
export interface EmbedderRuntime {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: number;
}

/** 当前生效的 embedder 运行时配置；无模型时返回 null（调用方须降级到非向量检索）。 */
export function embedderRuntime(settings: AiSettings): EmbedderRuntime | null {
  const env = readAiEnvConfig();
  const o = settings.roles?.embedder;
  const model = o?.model?.trim() || env.embedModel;
  if (!model) return null;
  return {
    baseUrl: o?.baseUrl?.trim() || env.embedBaseUrl || settings.baseUrl,
    apiKey: o?.apiKey?.trim() || env.embedApiKey || settings.apiKey,
    model,
    dimensions: o?.dimensions ?? env.embedDimensions,
  };
}

/** 向量可用前提：配置了模型 AND 有 key。缺 key 时调用必失败，静默跳过向量信号。 */
export function embedderReady(settings: AiSettings): boolean {
  const r = embedderRuntime(settings);
  return !!r && r.apiKey.length > 0;
}

export function resolveEmbedder(settings: AiSettings): AIProvider | null {
  const r = embedderRuntime(settings);
  if (!r) return null;
  return new OpenAICompatibleProvider({
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    model: r.model,
  });
}

/** searcher 的生效配置（角色覆盖优先，其次 env 默认）。 */
export interface SearcherRuntime {
  baseUrl: string;
  apiKey: string;
}

/**
 * 联网搜索运行时配置。key 只认专属来源（searcher 角色覆盖 / 搜索 env），
 * 绝不回退全局对话 key——跨厂商混用 key 必失败，静默比报错更糟。
 */
export function searcherRuntime(settings: AiSettings): SearcherRuntime | null {
  const env = readAiEnvConfig();
  const o = settings.roles?.searcher;
  const apiKey = o?.apiKey?.trim() || env.searchApiKey;
  if (!apiKey) return null;
  return {
    baseUrl: o?.baseUrl?.trim() || env.searchBaseUrl,
    apiKey,
  };
}

/** 联网可用前提：配了专属 key。未配置时聊天页连「联网」开关都不出现。 */
export function searcherReady(settings: AiSettings): boolean {
  return searcherRuntime(settings) !== null;
}

export function resolveSearcher(settings: AiSettings): WebSearchProvider | null {
  const r = searcherRuntime(settings);
  if (!r) return null;
  return new ExaWebProvider({ baseUrl: r.baseUrl, apiKey: r.apiKey });
}

/** env + 空 DB 覆盖时的兜底设置。 */
export function defaultAiSettings(): AiSettings {
  const env = readAiEnvConfig();
  return {
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: env.model,
  };
}

/** /api/settings 保存/测试共用的补丁形态（与 PUT 载荷一致）。 */
export interface SettingsPatch {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /**
   * 角色覆盖合并语义：字段空串=清除该字段（回退继承）；apiKey 空串=不改（key 不回传）；
   * 显式传 "__CLEAR__"=清除 apiKey；dimensions 可由 UI 以字符串（数字串）提交。
   */
  roles?: Partial<Record<AgentRole, Partial<RoleOverride> & { dimensions?: number | string }>>;
}

const SETTING_ROLES: AgentRole[] = ["thinker", "extractor", "embedder", "searcher"];

/**
 * 把保存/测试载荷应用到当前已存配置，产出「保存后生效」的设置。
 * 空字段的语义与角色覆盖的清理规则都在这里，是保存与「测草稿」唯一的对账点。
 */
export function mergeSettingsPatch(current: AiSettings, patch: SettingsPatch): AiSettings {
  const roles: AiSettings["roles"] = { ...(current.roles ?? {}) };
  for (const role of SETTING_ROLES) {
    const incoming = patch.roles?.[role] as
      | (Partial<RoleOverride> & { dimensions?: number | string })
      | undefined;
    if (!incoming) continue;
    const dims = incoming.dimensions as number | string | undefined;
    const merged: RoleOverride = {
      ...roles[role],
      ...(incoming.model !== undefined && { model: incoming.model.trim() }),
      ...(incoming.baseUrl !== undefined && { baseUrl: incoming.baseUrl.trim() }),
      ...(incoming.apiKey !== undefined &&
        incoming.apiKey.trim() !== "" && { apiKey: incoming.apiKey.trim() }),
      ...(dims !== undefined && dims !== "" && { dimensions: Number(dims) }),
    };
    for (const k of ["model", "baseUrl", "apiKey"] as const) {
      if (merged[k] === "") delete merged[k];
    }
    if (dims === "" || dims === undefined) delete merged.dimensions;
    if (incoming.apiKey === "__CLEAR__") delete merged.apiKey;
    if (Object.keys(merged).length === 0) {
      delete roles[role];
    } else {
      roles[role] = merged;
    }
  }
  return {
    baseUrl: patch.baseUrl?.trim() || current.baseUrl,
    apiKey: patch.apiKey?.trim() ? patch.apiKey.trim() : current.apiKey,
    model: patch.model?.trim() || current.model,
    roles,
  };
}
