import { ProviderError } from "./types";

/**
 * 联网搜索能力抽象。与 AIProvider 平行的独立小接口：搜索服务商不是
 * OpenAI 兼容协议（没有 chat/embeddings 概念），走各自 REST，因此不进
 * AIProvider，而由 registry.resolveSearcher() 单独解析。
 *
 * 铁律与 embedder 同款：调用方先查 searcherReady()，未配置 key 时整个
 * 功能静默不存在；任何网络失败都只降级、绝不允许挡住聊天主流程。
 */

export interface WebSource {
  title: string;
  url: string;
  /** 发布时间（ISO），来源可能不给 */
  publishedDate?: string | null;
}

export interface WebPageContent extends WebSource {
  /** 页面正文摘录 */
  text?: string;
}

export interface SearchOptions {
  numResults?: number;
}

export interface WebProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export interface WebSearchProvider {
  readonly config: WebProviderConfig;
  search(query: string, opts?: SearchOptions): Promise<WebSource[]>;
  fetchContents(urls: string[]): Promise<WebPageContent[]>;
}

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
}

/** Exa REST 适配器（POST {baseUrl}/search 与 /contents，x-api-key 头鉴权）。 */
export class ExaWebProvider implements WebSearchProvider {
  constructor(readonly config: WebProviderConfig) {}

  async search(query: string, opts: SearchOptions = {}): Promise<WebSource[]> {
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: opts.numResults ?? 5,
        contents: { highlights: true },
      }),
    });
    if (!res.ok) {
      throw new ProviderError(
        `web search failed: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    const data = (await res.json()) as { results?: ExaResult[] };
    return toSources(data.results);
  }

  async fetchContents(urls: string[]): Promise<WebPageContent[]> {
    if (urls.length === 0) return [];
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/contents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify({ ids: urls.slice(0, 3), text: { maxCharacters: CONTENT_MAX_CHARS } }),
    });
    if (!res.ok) {
      throw new ProviderError(
        `web contents failed: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    const data = (await res.json()) as { results?: ExaResult[] };
    return toSources(data.results, CONTENT_MAX_CHARS);
  }
}

/** 读链接正文的上限：够模型真读进去，又不撑爆上下文包。 */
const CONTENT_MAX_CHARS = 6000;

function toSources(results?: ExaResult[], maxChars = 500): WebPageContent[] {
  return (results ?? [])
    .filter((r): r is ExaResult & { url: string } => !!r.url)
    .map((r) => ({
      title: r.title?.trim() || hostOf(r.url),
      url: r.url,
      publishedDate: r.publishedDate ?? null,
      ...(r.highlights?.length || r.text
        ? {
            text:
              [...(r.highlights ?? []), r.text ?? ""]
                .filter(Boolean)
                .join(" … ")
                .slice(0, maxChars) || undefined,
          }
        : {}),
    }));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

/** 域名形态的 http(s) 链接：路径在空白/中文标点/括号处截断，避免把中文句子吞进 URL。 */
const URL_RE =
  /https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s<>"'()[\]{}，。；！？、]*)?/g;

/** 从用户消息里提取要读取的链接：去重、去尾部标点，最多 max 条。 */
export function extractUrls(text: string, max = 2): string[] {
  const found: string[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(/[),.;!?。；，！？]+$/, "");
    if (!found.includes(url)) found.push(url);
    if (found.length >= max) break;
  }
  return found;
}

/**
 * 搜索查询词：直接用用户原话。Exa 是神经检索，描述完整意图的句子
 * 远优于两三个关键词；截断只为防超长消息打爆请求体。
 */
export function deriveSearchQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** 本轮外部资料的收集结果：mode=read 表示读了链接正文，search 表示按话题检索。 */
export interface WebMaterial {
  mode: "read" | "search";
  query?: string;
  sources: WebSource[];
}

/**
 * 收集外部资料：消息带链接→读正文；否则以原话为查询搜索。
 * 网络失败会抛出，由调用方 try/catch 降级——联网永远不能挡住回复本身。
 */
export async function gatherWebMaterial(
  provider: WebSearchProvider,
  userText: string,
): Promise<WebMaterial> {
  const urls = extractUrls(userText);
  if (urls.length > 0) {
    const pages = await provider.fetchContents(urls);
    return { mode: "read", query: urls.join(" "), sources: pages };
  }
  const query = deriveSearchQuery(userText);
  return { mode: "search", query, sources: await provider.search(query) };
}
