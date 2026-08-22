import { readAiEnvConfig } from "@/lib/config";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AgentRole, AIProvider, ProviderConfig } from "./types";

export interface RoleModelOverride {
  model?: string;
}

/** 设置页存储的完整 AI 配置（DB settings 表 key="ai"，JSON）。 */
export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  roles?: Partial<Record<AgentRole, RoleModelOverride>>;
}

/**
 * 角色解析：业务代码只声明「我要 thinker」，不感知具体厂商/模型。
 * 优先级：DB 设置 > 环境变量 > 内置默认。
 */
export function resolveProvider(settings: AiSettings, role: AgentRole): AIProvider {
  const roleModel = settings.roles?.[role]?.model?.trim();
  const cfg: ProviderConfig = {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: roleModel || settings.model,
  };
  return new OpenAICompatibleProvider(cfg);
}

/**
 * embedder 是可选能力：未显式配置时返回 null，
 * 调用方必须降级到非向量检索，绝不允许因此报错。
 */
export function resolveEmbedder(settings: AiSettings): AIProvider | null {
  const model = settings.roles?.embedder?.model?.trim();
  if (!model) return null;
  return new OpenAICompatibleProvider({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
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
