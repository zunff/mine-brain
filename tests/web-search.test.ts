import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExaWebProvider,
  deriveSearchQuery,
  extractUrls,
  gatherWebMaterial,
  type WebSearchProvider,
} from "@/lib/providers/web-search";
import { resolveSearcher, searcherReady, type AiSettings } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";

afterEach(() => {
  delete process.env.MINE_BRAIN_SEARCH_API_KEY;
  delete process.env.MINE_BRAIN_SEARCH_BASE_URL;
  vi.unstubAllGlobals();
});

const base: AiSettings = {
  baseUrl: "https://global.example/v1",
  apiKey: "sk-global",
  model: "global-model",
};

/** 假搜索服务：记录调用，不碰网络。 */
function fakeProvider(impl: Partial<WebSearchProvider> = {}) {
  const merged: WebSearchProvider = {
    config: { baseUrl: "fake://", apiKey: "k" },
    search: async () => [{ title: "s", url: "https://s.example/a", publishedDate: null }],
    fetchContents: async (urls) => urls.map((url) => ({ title: "p", url, text: "正文" })),
    ...impl,
  };
  return {
    config: merged.config,
    search: vi.fn(merged.search),
    fetchContents: vi.fn(merged.fetchContents),
  };
}

describe("searcher 配置闸门（与 embedder 同款纪律：未配置=功能不存在）", () => {
  it("无角色覆盖且无 env key → 不就绪，resolveSearcher 为 null（调用方据此整体隐藏联网）", () => {
    expect(searcherReady(base)).toBe(false);
    expect(resolveSearcher(base)).toBeNull();
  });

  it("env 提供 key 即就绪；角色覆盖优先于 env", () => {
    process.env.MINE_BRAIN_SEARCH_API_KEY = "sk-env-exa";
    expect(searcherReady(base)).toBe(true);
    const p = resolveSearcher(base)!;
    expect(p.config.baseUrl).toBe("https://api.exa.ai");
    expect(p.config.apiKey).toBe("sk-env-exa");

    const overridden = resolveSearcher({
      ...base,
      roles: { searcher: { baseUrl: "https://bridge.example", apiKey: "sk-role" } },
    })!;
    // key 只认专属来源：角色覆盖后不得回落全局对话 key
    expect(overridden.config).toEqual({ baseUrl: "https://bridge.example", apiKey: "sk-role" });
  });

  it("全局有对话 key 但没配搜索 key 时仍不就绪——跨厂商混用 key 必失败", () => {
    expect(base.apiKey.length).toBeGreaterThan(0);
    expect(searcherReady(base)).toBe(false);
  });
});

describe("extractUrls / deriveSearchQuery", () => {
  it("提取链接并去掉尾部标点、去重、限量 2 条", () => {
    expect(
      extractUrls(
        "看这篇 https://a.example/x。还有 https://b.example/y，以及 https://a.example/x 再看 https://c.example/z",
      ),
    ).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  it("没有链接时返回空数组（纯文字走搜索分支）", () => {
    expect(extractUrls("我在纠结要不要换工作")).toEqual([]);
    expect(extractUrls("example.com 不是完整链接，不该被抓")).toEqual([]);
  });

  it("查询词用原话：折叠空白并截断到 300 字符", () => {
    const long = "纠结".repeat(200);
    expect(deriveSearchQuery(`  要不要\n换工作  `)).toBe("要不要 换工作");
    expect(deriveSearchQuery(long)).toHaveLength(300);
  });
});

describe("ExaWebProvider 协议适配", () => {
  it("search 走 POST {base}/search、x-api-key 头，结果映射标题/时间/highlights", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          requestId: "r1",
          results: [
            {
              title: "T",
              url: "https://a.example/x",
              publishedDate: "2026-08-01T00:00:00.000Z",
              highlights: ["h1", "h2"],
            },
            { url: "https://b.example" }, // 无标题→回退域名；无 highlights→无摘要
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = new ExaWebProvider({ baseUrl: "https://api.exa.ai", apiKey: "sk-x" });
    const sources = await p.search("要不要换工作", { numResults: 5 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-x");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "要不要换工作", numResults: 5 });

    expect(sources[0]).toEqual({
      title: "T",
      url: "https://a.example/x",
      publishedDate: "2026-08-01T00:00:00.000Z",
      text: "h1 … h2",
    });
    expect(sources[1]).toMatchObject({ title: "b.example", url: "https://b.example" });
  });

  it("非 2xx 抛 ProviderError 且带状态码——调用方捕获后降级为无外部资料", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 })),
    );
    const p = new ExaWebProvider({ baseUrl: "https://api.exa.ai", apiKey: "sk-x" });
    await expect(p.search("q")).rejects.toMatchObject({
      name: "ProviderError",
      status: 429,
    } satisfies Partial<ProviderError>);
  });

  it("fetchContents 空入参不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const p = new ExaWebProvider({ baseUrl: "https://api.exa.ai", apiKey: "sk-x" });
    expect(await p.fetchContents([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("gatherWebMaterial 分流契约", () => {
  it("消息带链接 → 读正文模式，不触发搜索", async () => {
    const fp = fakeProvider();
    const m = await gatherWebMaterial(fp, "帮我看看 https://a.example/post 这篇说得对吗");
    expect(m.mode).toBe("read");
    expect(fp.fetchContents).toHaveBeenCalledWith(["https://a.example/post"]);
    expect(fp.search).not.toHaveBeenCalled();
    expect((m.sources[0] as { text?: string }).text).toBe("正文");
  });

  it("纯文字 → 以原话为查询的搜索模式，绝不读链接之外的东西", async () => {
    const fp = fakeProvider();
    const m = await gatherWebMaterial(fp, "最近 AI 行业裁员潮，我的跳槽计划要变吗？");
    expect(m.mode).toBe("search");
    expect(m.query).toBe("最近 AI 行业裁员潮，我的跳槽计划要变吗？");
    expect(fp.search).toHaveBeenCalledTimes(1);
    expect(fp.fetchContents).not.toHaveBeenCalled();
  });

  it("网络失败向上抛出——降级是编排器调用方的责任（try/catch 包住）", async () => {
    const fp = fakeProvider({ search: vi.fn(async () => {
      throw new ProviderError("boom", 500);
    }) });
    await expect(gatherWebMaterial(fp, "随便聊聊")).rejects.toBeInstanceOf(ProviderError);
  });
});
