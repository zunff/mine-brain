import { readAiEnvConfig } from "@/lib/config";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AgentRole, AIProvider, ProviderConfig, RoleOverride } from "./types";

/** 设置页存储的完整 AI 配置（DB settings 表 key="ai"，JSON）。 */
export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  roles?: Partial<Record<AgentRole, RoleOverride>>;
}

/**
 * 角色解析：业务代码只声明「我要 thinker」，不感知具体厂商/模型。
 * 每个角色的 model/baseUrl/apiKey 都可独立覆盖（留空回退全局），
 * 全局值本身来自 DB 设置 > 环境变量 > 内置默认。
 */
export function resolveProvider(settings: AiSettings, role: AgentRole): AIProvider {
  const o = settings.roles?.[role];
  const cfg: ProviderConfig = {
    baseUrl: o?.baseUrl?.trim() || settings.baseUrl,
    apiKey: o?.apiKey?.trim() || settings.apiKey,
    model: o?.model?.trim() || settings.model,
  };
  return new OpenAICompatibleProvider(cfg);
}

/**
 * embedder 是可选能力：只有显式配置了模型才启用，
 * 调用方必须降级到非向量检索，绝不允许因此报错。
 */
export function resolveEmbedder(settings: AiSettings): AIProvider | null {
  const o = settings.roles?.embedder;
  const model = o?.model?.trim();
  if (!model) return null;
  return new OpenAICompatibleProvider({
    baseUrl: o?.baseUrl?.trim() || settings.baseUrl,
    apiKey: o?.apiKey?.trim() || settings.apiKey,
    model,
  });
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
