import { resolveProvider, resolveSearcher, searcherReady, type AiSettings } from "@/lib/providers/registry";
import { parseJsonLoose } from "@/lib/memory/consolidate";
import { buildContextBundle, type ContextBundle } from "@/lib/memory/retrieve";
import { linksFor } from "@/lib/memory/repo";
import { MEMORY_TYPE_LABELS, type MemoryRow } from "@/lib/memory/types";
import type { WebPageContent, WebSearchProvider } from "@/lib/providers/web-search";
import type { OrchestratorEvent, ResearchPanelStep, RetrievalTrace } from "./chat-events";

/**
 * 深度研究（Deep Research）：同一 runChat 管道上的前置查证阶段。
 *
 * 受控 ReAct（应用层协议，不依赖原生 tool calling）：
 * - 固定主探针先跑一轮（保证「主问题查询」永远存在）；
 * - Controller 每轮只输出一个 JSON Action，编排器执行只读工具，
 *   把压缩后的 Observation 回传给 Controller 决定下一步（继续/换向/反例/结束）；
 * - 反例查询是硬约束：循环结束时缺反例就确定性补跑一次；
 * - 全程有界（轮数/工具次数/网页篇数封顶），任何失败只降级不报错；
 * - 最终成文仍走现有 chatStream，reasoning_content 只展示最终回答模型的真实思考。
 */

/* ---------------- 类型 ---------------- */

export type ResearchTarget = "memory" | "web" | "both";

export type ResearchToolName =
  | "memory_search"
  | "memory_tension"
  | "memory_timeline"
  | "open_loop_search"
  | "web_search"
  | "web_fetch"
  | "finish";

/** Controller 单轮输出的结构化动作（宽松形态，字段可能缺失）。 */
export interface ResearchAction {
  action: ResearchToolName;
  query?: string;
  urls?: string[];
  purpose?: string;
  reason?: string;
}

export interface ResearchStep {
  index: number;
  /** 工具名（trace 卡片可见，如 memory_tension） */
  tool: ResearchToolName;
  query: string;
  target: ResearchTarget;
  /** 本步新增（账本去重后）的记忆 */
  memory?: MemoryRow[];
  /** 本步新增的外部资料 */
  web?: WebPageContent[];
  purpose?: string;
  note?: string;
  /** Controller 选定此查询时的真实思考（reasoning_content 原文，随 trace 展示）。 */
  reasoning?: string;
}

export interface ResearchBrief {
  steps: ResearchStep[];
  /** 本次研究缺失的能力（如 web 未配置），供最终成文如实标注。 */
  degraded: string[];
}

/* ---------------- 有界常量 ---------------- */

const MAX_AGENT_TURNS = 3;
const MAX_TOOL_CALLS = 5;
const MAX_WEB_FETCH_PAGES = 2;
const CONTROLLER_MAX_TOKENS = 2048;
const CONTROLLER_TEMPERATURE = 0.2;
const PROBE_MEMORY_LIMIT = 8;
const STEP_MEMORY_LIMIT = 6;
const STEP_WEB_LIMIT = 5;
const BRIEF_MEMORY_TOTAL = 30;
const BRIEF_WEB_TOTAL = 12;
const WEB_SNIPPET_CHARS = 500;

/* ---------------- Action 解析 ---------------- */

const COUNTER_RE =
  /反例|反面|相反|反驳|风险|盲点|对立|质疑|反对|counter|against|downside|risk/i;

/** 容错解析 Controller 输出：剥围栏取 JSON，动作名必须在白名单内，否则视为无效。 */
export function extractResearchAction(text: string): ResearchAction | null {
  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed) return null;
  const name = parsed.action;
  if (
    name !== "memory_search" &&
    name !== "memory_tension" &&
    name !== "memory_timeline" &&
    name !== "open_loop_search" &&
    name !== "web_search" &&
    name !== "web_fetch" &&
    name !== "finish"
  ) {
    return null;
  }
  const action: ResearchAction = { action: name };
  if (typeof parsed.query === "string" && parsed.query.trim()) {
    action.query = parsed.query.trim().slice(0, 300);
  }
  if (Array.isArray(parsed.urls)) {
    action.urls = parsed.urls
      .filter((u): u is string => typeof u === "string")
      .slice(0, MAX_WEB_FETCH_PAGES);
  }
  if (typeof parsed.purpose === "string") action.purpose = parsed.purpose.slice(0, 60);
  if (typeof parsed.reason === "string") action.reason = parsed.reason.slice(0, 200);
  const needsQuery = name === "memory_search" || name === "memory_tension" ||
    name === "memory_timeline" || name === "open_loop_search" || name === "web_search";
  if (needsQuery && !action.query) return null;
  if (name === "web_fetch" && !(action.urls && action.urls.length > 0)) return null;
  return action;
}

export function isCounterPurpose(purpose: string | undefined, query: string): boolean {
  return COUNTER_RE.test(`${purpose ?? ""} ${query}`);
}

/** 反例证据是硬约束：全部步骤里没有任何反例查询时为 true（编排器据此强制补跑）。 */
export function missingCounterEvidence(steps: ResearchStep[]): boolean {
  return !steps.some(
    (s) => s.purpose !== "main_probe" && s.tool !== "web_fetch" && isCounterPurpose(s.purpose, s.query),
  );
}

/* ---------------- 记忆工具（只读，复用多信号检索） ---------------- */

function bundleForQuery(query: string): ContextBundle {
  return buildContextBundle(query, { deepThinking: true });
}

function dedupeRows(lists: MemoryRow[][]): MemoryRow[] {
  const seen = new Set<number>();
  const out: MemoryRow[] = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** 主探针 / memory_search：相关 + 张力 + 开放回路 + 时间线的并集。 */
export function toolMemorySearch(query: string): MemoryRow[] {
  const b = bundleForQuery(query);
  return dedupeRows([b.related, b.tensions, b.openLoops, b.timeline ?? []]);
}

/** memory_tension：沿 contradicts/supersedes 边专拉对立面与被推翻立场。 */
export function toolMemoryTension(query: string): MemoryRow[] {
  const b = bundleForQuery(query);
  const edgeOpponents: MemoryRow[] = [];
  const relatedIds = new Set(b.related.map((m) => m.id));
  const linkMap = linksFor(b.related.map((m) => m.id));
  const byId = new Map<number, MemoryRow>();
  for (const m of dedupeRows([b.tensions, b.related])) byId.set(m.id, m);
  for (const [, edges] of linkMap) {
    for (const e of edges) {
      if (e.rel !== "contradicts" && e.rel !== "supersedes") continue;
      const otherId = relatedIds.has(e.from_id) ? e.to_id : e.from_id;
      const other = byId.get(otherId);
      if (other) edgeOpponents.push(other);
    }
  }
  return dedupeRows([b.tensions, edgeOpponents]);
}

/** memory_timeline：同主题主张/决定按时间先后回溯（含已被推翻的历史立场）。 */
export function toolMemoryTimeline(query: string): MemoryRow[] {
  return bundleForQuery(query).timeline ?? [];
}

/** open_loop_search：仍未解的反复纠结。 */
export function toolOpenLoopSearch(query: string): MemoryRow[] {
  return bundleForQuery(query).openLoops;
}

/* ---------------- 外部工具（白名单 + 预算封顶） ---------------- */

/**
 * web_search/web_fetch 的受控封装：
 * fetch 只允许读取本工具自己搜到的 URL（防模型指路任意地址），全研究最多读 2 篇。
 */
export class WebResearchTools {
  private fetchedCount = 0;
  private readonly knownUrls = new Set<string>();
  private readonly fetchedUrls = new Set<string>();

  constructor(private readonly provider: WebSearchProvider) {}

  async search(query: string): Promise<WebPageContent[]> {
    const sources = (await this.provider.search(query, {
      numResults: STEP_WEB_LIMIT,
    })) as WebPageContent[];
    for (const s of sources) this.knownUrls.add(s.url);
    return sources;
  }

  /** 返回 null 表示该批 URL 全部不在白名单内（不可信来源，拒绝抓取）。 */
  async fetch(urls: string[]): Promise<WebPageContent[] | null> {
    const allowed = urls.filter((u) => this.knownUrls.has(u) && !this.fetchedUrls.has(u));
    if (allowed.length === 0) return null;
    const room = Math.max(0, MAX_WEB_FETCH_PAGES - this.fetchedCount);
    if (room === 0) return [];
    const batch = allowed.slice(0, room);
    this.fetchedCount += batch.length;
    for (const u of batch) this.fetchedUrls.add(u);
    return this.provider.fetchContents(batch);
  }

  /** 已搜到但还没深读的候选 URL（Controller 的 web_fetch 只能从中选）。 */
  unfetchedUrls(): string[] {
    return [...this.knownUrls].filter((u) => !this.fetchedUrls.has(u));
  }

  hasUnfetched(): boolean {
    return this.unfetchedUrls().length > 0;
  }

  remainingFetch(): number {
    return Math.max(0, MAX_WEB_FETCH_PAGES - this.fetchedCount);
  }
}

/* ---------------- 证据账本 ---------------- */

class EvidenceLedger {
  private readonly memories = new Map<number, MemoryRow>();
  private readonly webByUrl = new Map<string, WebPageContent>();
  memoryCapped = false;
  webCapped = false;

  /** 只收录新记忆；返回本步新增切片（供纪要逐步展示）。 */
  takeMemory(rows: MemoryRow[]): MemoryRow[] {
    const fresh: MemoryRow[] = [];
    for (const m of rows) {
      if (this.memories.has(m.id)) continue;
      if (this.memories.size >= BRIEF_MEMORY_TOTAL) {
        this.memoryCapped = true;
        break;
      }
      this.memories.set(m.id, m);
      fresh.push(m);
    }
    return fresh;
  }

  takeWeb(pages: WebPageContent[]): WebPageContent[] {
    const fresh: WebPageContent[] = [];
    for (const p of pages) {
      if (this.webByUrl.has(p.url)) continue;
      if (this.webByUrl.size >= BRIEF_WEB_TOTAL) {
        this.webCapped = true;
        break;
      }
      this.webByUrl.set(p.url, p);
      fresh.push(p);
    }
    return fresh;
  }
}

/* ---------------- Controller 提示词 ---------------- */

function compressObservation(step: ResearchStep): string {
  const memTitles = (step.memory ?? [])
    .slice(0, 4)
    .map((m) => m.title || m.content.slice(0, 20));
  const webTitles = (step.web ?? []).slice(0, 3).map((w) => w.title);
  const parts: string[] = [];
  if (memTitles.length > 0) parts.push(`记忆 ${step.memory!.length} 条：${memTitles.join("、")}`);
  if (webTitles.length > 0) parts.push(`网页 ${step.web!.length} 篇：${webTitles.join("、")}`);
  if (parts.length === 0) parts.push(step.note ?? "未命中");
  else if (step.note) parts.push(`（${step.note}）`);
  return parts.join("；").slice(0, 220);
}

export function buildControllerPrompt(opts: {
  question: string;
  memoryDigest: string;
  history: string[];
  webAvailable: boolean;
  logLines: string[];
  fetchCandidates: string[];
  remainingTurns: number;
  remainingCalls: number;
  needCounter: boolean;
}): string {
  return `你是「深度研究」的查证控制器，替思考伙伴收集证据。你绝不直接回答用户，每轮只输出一个 JSON 动作。

【用户本次的问题】
${opts.question}

【已直接调取到的记忆（不必重复查证）】
${opts.memoryDigest || "（暂无）"}

【近期对话】
${opts.history.length ? opts.history.join("\n") : "（无）"}

【联网能力】${opts.webAvailable ? "已配置：可搜外部实时资料" : "未配置：不要安排 web 类动作"}

【已完成查证与观察】
${opts.logLines.length ? opts.logLines.map((l) => `- ${l}`).join("\n") : "- （尚无）"}
${opts.fetchCandidates.length > 0 ? `\n【待深读的网页候选（web_fetch 只能从中选）】\n${opts.fetchCandidates.map((u) => `- ${u}`).join("\n")}` : ""}

【硬性要求】
- 剩余预算：至多 ${opts.remainingTurns} 轮决策、${opts.remainingCalls} 次工具调用；
- ${opts.needCounter ? "尚未安排反例查询：下一轮必须安排一条反例/反面证据查证（purpose 用 counter_evidence）" : "反例查证已完成"}；
- 不要重复已做过的查询；连续两轮无新增证据就应 finish；
- 证据足够、或剩余预算内找不到更有价值的查证时，立即 finish。

可选动作（只输出其一，纯 JSON，不要任何其它文字）：
{"action":"memory_search","query":"...","purpose":"historical_context|counter_evidence|blind_spot"}
{"action":"memory_tension","query":"...","purpose":"counter_evidence"}
{"action":"memory_timeline","query":"...","purpose":"evolution"}
{"action":"open_loop_search","query":"...","purpose":"blind_spot"}
{"action":"web_search","query":"...","purpose":"fact_check|counter_evidence"}
{"action":"web_fetch","urls":["..."],"purpose":"inspect_source"}
{"action":"finish","reason":"为什么证据已够"}`;
}

/* ---------------- Step 构造与呈现 ---------------- */

function toolToTarget(tool: ResearchToolName): ResearchTarget {
  if (tool === "web_search" || tool === "web_fetch") return "web";
  if (tool === "finish") return "both";
  return "memory";
}

/** 研究步骤 → 前端面板的一步（工具 + 查询 + 思考 + 搜到什么 + 引用的网页）。 */
export function stepToPanelStep(step: ResearchStep): ResearchPanelStep {
  return {
    tool: step.tool,
    query: step.query,
    ...(step.reasoning ? { thinking: step.reasoning } : {}),
    ...(step.note ? { note: step.note } : {}),
    memoryTitles: (step.memory ?? []).map((m) => m.title || m.content.slice(0, 24)),
    web: (step.web ?? []).map((w) => ({
      title: w.title,
      url: w.url,
      publishedDate: w.publishedDate ?? null,
    })),
  };
}

export function researchStepToTrace(step: ResearchStep): RetrievalTrace {
  const memCount = step.memory?.length ?? 0;
  const webCount = step.web?.length ?? 0;
  const total = memCount + webCount;
  const label = step.query.length > 30 ? `${step.query.slice(0, 30)}…` : step.query;
  const toolLabel: Record<string, string> = {
    memory_search: "记忆检索",
    memory_tension: "矛盾对立面",
    memory_timeline: "立场时间线",
    open_loop_search: "未解纠结",
    web_search: "外部检索",
    web_fetch: "深读网页",
  };
  return {
    id: `trace_research_${step.index}`,
    name: `${toolLabel[step.tool] ?? step.tool}「${label}」`,
    description:
      step.note ??
      `命中 ${memCount} 条记忆${webCount > 0 ? `、${webCount} 条外部资料` : ""}`,
    count: total,
    details: [
      ...(step.memory ?? []).slice(0, 3).map((m) => m.title || m.content.slice(0, 24)),
      ...(step.web ?? []).slice(0, 3).map((s) => s.title),
    ],
    ...(step.reasoning ? { thinking: step.reasoning } : {}),
  };
}

/** 把研究纪要格式化成最终成文的 system prompt 段落。 */
export function buildResearchBriefSection(brief: ResearchBrief): string {
  const lines: string[] = [
    "【研究纪要 · 本轮深度研究的查证结果】",
    "以下是针对本次问题多角度查证的证据汇总，成文时必须遵守：",
    "- 记忆类证据是用户本人的过去记录（标注类型与时间）；外部资料是世界的说法，不是用户的记忆，引用必须注明来源与时间，没有把握就说明不确定；",
    "- 主动对照反例证据与用户过往立场：哪一方证据更强、用户的直觉是否与已知事实相左，别回避不利证据；",
    "- 不编造查证结果；某条子问题未命中就如实说没查到。",
  ];
  if (brief.degraded.includes("web")) {
    lines.push("- 本次未配置联网搜索，外部资料部分缺失，结论应如实标注这一局限。");
  }
  for (const step of brief.steps) {
    const mems = step.memory ?? [];
    const webs = step.web ?? [];
    lines.push(`\n◆ [${step.tool}] ${step.query}${step.note ? `（${step.note}）` : ""}`);
    if (mems.length === 0 && webs.length === 0) {
      lines.push("  未命中任何查证结果。");
      continue;
    }
    for (const m of mems.slice(0, STEP_MEMORY_LIMIT)) {
      const type = MEMORY_TYPE_LABELS[m.type] ?? m.type;
      const date = (m.valid_from ?? m.created_at).slice(0, 10);
      const revoked = m.status === "superseded" ? "（已被推翻）" : "";
      lines.push(`  · [记忆 · ${type} · ${date}] ${m.content.slice(0, 300)}${revoked}`);
    }
    for (const w of webs.slice(0, STEP_WEB_LIMIT)) {
      const date = w.publishedDate ? ` · ${w.publishedDate.slice(0, 10)}` : "";
      lines.push(
        `  · [外部 · ${w.title} · ${w.url}]${date}${w.text ? ` ${w.text.slice(0, WEB_SNIPPET_CHARS)}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/* ---------------- 研究阶段入口 ---------------- */

export interface ResearchPhaseInput {
  settings: AiSettings;
  question: string;
  memoryDigest: string;
  history: string[];
}

/**
 * 研究阶段（生成器）：主探针 → 受控 ReAct 循环 → 缺反例则强制补跑 → 汇成纪要。
 * 规划期思考不外发（保持「思考过程=最终回答模型的 reasoning」语义），过程经 status/trace 呈现；
 * 任何失败只降级：Controller 失效也仍有主探针+强制反例两条保底证据。返回 null 表示整体失败。
 */
export async function* runResearchPhase(
  input: ResearchPhaseInput,
): AsyncGenerator<OrchestratorEvent, ResearchBrief | null, void> {
  try {
    yield { type: "status", text: "正在建立研究基线（主问题探针）..." };

    const webAvailable = searcherReady(input.settings);
    const degraded: string[] = [];
    const webTools = webAvailable ? new WebResearchTools(resolveSearcher(input.settings)!) : null;
    if (!webAvailable) degraded.push("web");

    const ledger = new EvidenceLedger();
    const steps: ResearchStep[] = [];

    const recordStep = (
      tool: ResearchToolName,
      query: string,
      opts: { memory?: MemoryRow[]; web?: WebPageContent[]; purpose?: string; note?: string },
    ): ResearchStep => {
      const step: ResearchStep = {
        index: steps.length + 1,
        tool,
        query,
        target: toolToTarget(tool),
        ...(opts.memory && opts.memory.length > 0 ? { memory: opts.memory } : {}),
        ...(opts.web && opts.web.length > 0 ? { web: opts.web } : {}),
        ...(opts.purpose ? { purpose: opts.purpose } : {}),
        ...(opts.note ? { note: opts.note } : {}),
      };
      steps.push(step);
      return step;
    };

    // 1. 主探针：保证「主问题查询」无条件存在，同时给 Controller 第一手观察
    const probeHits = ledger.takeMemory(
      toolMemorySearch(input.question).slice(0, PROBE_MEMORY_LIMIT),
    );
    const probeStep = recordStep("memory_search", input.question.slice(0, 80), {
      memory: probeHits,
      purpose: "main_probe",
      note: probeHits.length === 0 ? "主问题探针 · 未命中相关记忆" : "主问题探针",
    });
    yield { type: "research", step: stepToPanelStep(probeStep) };
    yield { type: "trace", trace: researchStepToTrace(probeStep) };

    // 2. Controller 循环
    const controller = resolveProvider(input.settings, "thinker");
    const logLines: string[] = [];
    let toolCalls = 1; // 主探针占 1 次

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      if (MAX_TOOL_CALLS - toolCalls <= 0) break; // 工具预算用尽：不再消耗一次 controller 调用
      yield { type: "status", text: "正在分析已有证据，决定下一步查证方向..." };

      const prompt = buildControllerPrompt({
        question: input.question,
        memoryDigest: input.memoryDigest,
        history: input.history,
        webAvailable: webAvailable,
        logLines,
        fetchCandidates: webTools ? webTools.unfetchedUrls() : [],
        remainingTurns: MAX_AGENT_TURNS - turn,
        remainingCalls: MAX_TOOL_CALLS - toolCalls,
        needCounter: missingCounterEvidence(steps),
      });

      let action: ResearchAction | null = null;
      let controllerReasoning: string | undefined;
      try {
        const res = await controller.chat(
          [
            { role: "system", content: "你是研究查证控制器，只输出合法 JSON 动作。" },
            { role: "user", content: prompt },
          ],
          { maxTokens: CONTROLLER_MAX_TOKENS, temperature: CONTROLLER_TEMPERATURE },
        );
        action = extractResearchAction(res.content);
        controllerReasoning = res.reasoning; // 模型选定该查询时的真实思考，随步骤展示
      } catch (err) {
        console.error("[research] controller failed:", err);
        break;
      }
      if (!action) break; // 输出非法：放弃剩余轮次，走保底收尾
      if (action.action === "finish") break;
      toolCalls += 1;

      yield {
        type: "status",
        text: `正在查证（${steps.length + 1}/${MAX_TOOL_CALLS}）：${(action.query ?? action.action).slice(0, 40)}...`,
      };

      const step = await executeAction(action, { ledger, webTools, degraded });
      step.index = steps.length + 1;
      if (controllerReasoning) step.reasoning = controllerReasoning.slice(0, 600);
      steps.push(step);
      logLines.push(
        `[${step.tool}] ${step.query} → ${compressObservation(step)}`.slice(0, 260),
      );
      yield { type: "research", step: stepToPanelStep(step) };
      yield { type: "trace", trace: researchStepToTrace(step) };
    }

    // 3. 反例硬约束：全程没查过反例就确定性补一条（记忆 + 可用时外部）
    if (missingCounterEvidence(steps)) {
      const counterQuery = `${input.question.replace(/\s+/g, " ").trim().slice(0, 120)} 相反的证据、风险与盲点`;
      yield { type: "status", text: "正在补查反例与反面证据..." };
      const memoryHits = ledger.takeMemory(toolMemoryTension(counterQuery));
      let webHits: WebPageContent[] | undefined;
      if (webTools) {
        try {
          webHits = ledger.takeWeb(await webTools.search(counterQuery));
        } catch (err) {
          console.error("[research] counter web_search failed:", err);
        }
      }
      const step = recordStep("memory_tension", counterQuery, {
        memory: memoryHits,
        web: webHits,
        purpose: "counter_evidence",
        note:
          memoryHits.length === 0 && !webHits?.length
            ? "反例补查 · 未命中反例素材"
            : memoryHits.length === 0
              ? "反例补查 · 记忆侧无对立记录，反例来自外部"
              : "反例补查",
      });
      yield { type: "research", step: stepToPanelStep(step) };
      yield { type: "trace", trace: researchStepToTrace(step) };
    }

    yield { type: "status", text: "研究纪要已就绪，正在综合成文..." };
    return { steps, degraded };
  } catch (err) {
    console.error("[research] phase failed:", err);
    return null;
  }
}

interface ActionDeps {
  ledger: EvidenceLedger;
  webTools: WebResearchTools | null;
  degraded: string[];
}

async function executeAction(action: ResearchAction, deps: ActionDeps): Promise<ResearchStep> {
  const query = action.query ?? "";
  if (action.action === "web_search" || action.action === "web_fetch") {
    if (!deps.webTools) {
      if (!deps.degraded.includes("web")) deps.degraded.push("web");
      return buildWeblessStep(action, query, "未配置联网，跳过外部资料");
    }
    try {
      if (action.action === "web_search") {
        const hits = deps.ledger.takeWeb(await deps.webTools.search(query));
        return {
          index: 0,
          tool: "web_search",
          query,
          target: "web",
          ...(hits.length > 0 ? { web: hits } : {}),
          ...(action.purpose ? { purpose: action.purpose } : {}),
          ...(hits.length === 0 ? { note: "未命中外部资料" } : {}),
        };
      }
      const pages = await deps.webTools.fetch(action.urls ?? []);
      const hits = pages ? deps.ledger.takeWeb(pages) : [];
      return {
        index: 0,
        tool: "web_fetch",
        query: (action.urls ?? []).join(" "),
        target: "web",
        ...(hits.length > 0 ? { web: hits } : {}),
        ...(action.purpose ? { purpose: action.purpose } : {}),
        ...(pages === null
          ? { note: "URL 不在已检索结果中，拒绝抓取" }
          : hits.length === 0
            ? { note: "无可读正文（预算用尽或内容为空）" }
            : {}),
      };
    } catch (err) {
      console.error(`[research] ${action.action} failed:`, err);
      return buildWeblessStep(action, query, "联网查证失败（已跳过）");
    }
  }

  // 记忆类工具
  const rows =
    action.action === "memory_tension"
      ? toolMemoryTension(query)
      : action.action === "memory_timeline"
        ? toolMemoryTimeline(query)
        : action.action === "open_loop_search"
          ? toolOpenLoopSearch(query)
          : toolMemorySearch(query);
  const hits = deps.ledger.takeMemory(rows.slice(0, STEP_MEMORY_LIMIT + 2));
  const emptyNote: Record<string, string> = {
    memory_search: "未命中相关记忆",
    memory_tension: "未发现对立立场记录",
    memory_timeline: "该主题暂无足够的历史演进记录",
    open_loop_search: "没有相关的未解纠结",
  };
  return {
    index: 0,
    tool: action.action,
    query,
    target: "memory",
    ...(hits.length > 0 ? { memory: hits } : {}),
    ...(action.purpose ? { purpose: action.purpose } : {}),
    ...(hits.length === 0 ? { note: emptyNote[action.action] ?? "未命中" } : {}),
  };
}

function buildWeblessStep(
  action: ResearchAction,
  query: string,
  note: string,
): ResearchStep {
  return {
    index: 0,
    tool: action.action,
    query,
    target: "web",
    ...(action.purpose ? { purpose: action.purpose } : {}),
    note,
  };
}
