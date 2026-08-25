import { getAiSettings } from "@/lib/memory/repo";
import {
  embedderRuntime,
  mergeSettingsPatch,
  resolveProvider,
  searcherRuntime,
  type AiSettings,
  type SettingsPatch,
} from "@/lib/providers/registry";
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible";
import { ExaWebProvider } from "@/lib/providers/web-search";
import { ProviderError, type AgentRole } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

type TestTarget = "global" | AgentRole;

interface TestBody {
  target?: TestTarget;
  /** 整页草稿（未保存）。与保存载荷同形，合并语义与保存一致——测的就是「现在保存后是哪套配置、能不能通」。 */
  draft?: SettingsPatch;
}

type TestPlan =
  | {
      kind: "chat" | "embed";
      cfg: { baseUrl: string; apiKey: string; model: string };
      dimensions?: number;
    }
  | {
      kind: "search";
      cfg: { baseUrl: string; apiKey: string; model?: string };
    };

type PlanResult =
  | { ok: true; plan: TestPlan }
  | { ok: false; skipped: boolean; error: string };

/**
 * 组装「当前已存 + 草稿」的生效设置，并按目标选定探针与跳过条件。
 * 纯逻辑、零网络，供单测离线覆盖；POST 只负责把 plan 执行出去。
 */
export function buildTestPlan(stored: AiSettings, patch: SettingsPatch, target: TestTarget): PlanResult {
  const eff = mergeSettingsPatch(stored, patch);
  if (target === "global") {
    if (!eff.apiKey) return { ok: false, skipped: true, error: "全局未配置 API Key" };
    return {
      ok: true,
      plan: { kind: "chat", cfg: { baseUrl: eff.baseUrl, apiKey: eff.apiKey, model: eff.model } },
    };
  }
  if (target === "embedder") {
    const r = embedderRuntime(eff);
    if (!r) return { ok: false, skipped: true, error: "未配置嵌入模型" };
    if (!r.apiKey) return { ok: false, skipped: true, error: "embedder 未配置 API Key" };
    return {
      ok: true,
      plan: {
        kind: "embed",
        dimensions: r.dimensions,
        cfg: { baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model },
      },
    };
  }
  if (target === "searcher") {
    const r = searcherRuntime(eff);
    if (!r) return { ok: false, skipped: true, error: "searcher 未配置 API Key" };
    return { ok: true, plan: { kind: "search", cfg: { baseUrl: r.baseUrl, apiKey: r.apiKey } } };
  }
  // thinker/extractor：与对话同链路
  if (!eff.apiKey && !eff.roles?.[target]?.apiKey) {
    return { ok: false, skipped: true, error: `「${target}」未配置 API Key` };
  }
  const p = resolveProvider(eff, target);
  return { ok: true, plan: { kind: "chat", cfg: p.config } };
}

/** 连接测试：先出 plan（含跳过判断），再按目标执行真实探针。网络失败只如实报错，不影响主流程。 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as TestBody | null;
  if (!body?.target) return Response.json({ error: "invalid body" }, { status: 400 });

  const planRes = buildTestPlan(getAiSettings(), body.draft ?? {}, body.target);
  if (!planRes.ok) {
    return Response.json(
      { ok: false, skipped: planRes.skipped, error: planRes.error },
      { status: planRes.skipped ? 200 : 400 },
    );
  }
  const plan = planRes.plan;
  try {
    if (plan.kind === "chat") {
      const provider = new OpenAICompatibleProvider(plan.cfg);
      const res = await provider.chat(
        [{ role: "user", content: "回复：连接成功" }],
        { maxTokens: 2000, temperature: 0 },
      );
      return Response.json({ ok: true, model: res.model, reply: res.content.slice(0, 50) });
    }
    if (plan.kind === "embed") {
      const provider = new OpenAICompatibleProvider(plan.cfg);
      const vectors = await provider.embed!(["连接测试"]);
      return Response.json({ ok: true, model: plan.cfg.model, dimensions: vectors[0]?.length });
    }
    const provider = new ExaWebProvider(plan.cfg);
    const sources = await provider.search("连接测试", { numResults: 1 });
    return Response.json({ ok: true, baseUrl: plan.cfg.baseUrl, hits: sources.length });
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : undefined;
    return Response.json(
      {
        ok: false,
        status,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
      { status: 502 },
    );
  }
}