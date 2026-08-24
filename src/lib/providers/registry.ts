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
