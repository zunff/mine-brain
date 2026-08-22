/**
 * 环境层默认配置。真实密钥只放 .env.local（gitignore）或运行时 DB 设置表，
 * 这里绝不硬编码密钥。DB 设置（设置页写入）优先级高于环境变量。
 */
export interface AiEnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function readAiEnvConfig(): AiEnvConfig {
  return {
    baseUrl:
      process.env.MINE_BRAIN_AI_BASE_URL?.trim() || "https://opencode.ai/zen/v1",
    apiKey: process.env.MINE_BRAIN_AI_API_KEY?.trim() || "",
    model: process.env.MINE_BRAIN_AI_MODEL?.trim() || "x-preview-f-free",
  };
}
