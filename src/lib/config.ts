/**
 * 环境层默认配置。真实密钥只放 .env.local（gitignore）或运行时 DB 设置表，
 * 这里绝不硬编码密钥。embedding 默认指向阿里云百炼 OpenAI 兼容端点 + qwen3.7-text-embedding
 * （免费额度内零成本；换模型只需改这里/设置页，切换后点「重新向量化」）。
 */
export interface AiEnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  embedBaseUrl: string;
  embedModel: string;
  embedApiKey: string;
  embedDimensions: number;
}

export function readAiEnvConfig(): AiEnvConfig {
  return {
    baseUrl:
      process.env.MINE_BRAIN_AI_BASE_URL?.trim() || "https://opencode.ai/zen/v1",
    apiKey: process.env.MINE_BRAIN_AI_API_KEY?.trim() || "",
    model: process.env.MINE_BRAIN_AI_MODEL?.trim() || "x-preview-f-free",
    embedBaseUrl:
      process.env.MINE_BRAIN_EMBED_BASE_URL?.trim() ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    embedModel: process.env.MINE_BRAIN_EMBED_MODEL?.trim() || "qwen3.7-text-embedding",
    embedApiKey: process.env.MINE_BRAIN_EMBED_API_KEY?.trim() || "",
    embedDimensions: Number(process.env.MINE_BRAIN_EMBED_DIMENSIONS || "1024"),
  };
}
