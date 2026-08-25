import type { ContextBundle } from "@/lib/memory/retrieve";
import type { AssistantPreferences } from "@/lib/memory/onboarding";
import { MEMORY_TYPE_LABELS, type MemoryRow } from "@/lib/memory/types";
import type { WebMaterial } from "@/lib/providers/web-search";
import { buildResearchBriefSection, type ResearchBrief } from "./research";

/**
 * 思考伙伴人格。设计原则见 .claude/rules/project.md：
 * 伙伴而非助手、先反方后认可、时间显式、不编造记忆、接住与挑战并重。
 */

function fmtMemory(m: MemoryRow): string {
  const type = MEMORY_TYPE_LABELS[m.type] ?? m.type;
  const date = (m.valid_from ?? m.created_at).slice(0, 10);
  const theme = m.theme ? ` · 域:${m.theme}` : "";
  const title = m.title ? `「${m.title}」` : "";
  const status = m.status === "superseded" ? "（已被后来的你推翻）" : "";
  return `- [${type} · ${date}${theme}]${title} ${m.content}${status}`;
}

function fmtWeb(w: WebMaterial): string {
  const origin =
    w.mode === "read"
      ? "以下是用户消息中链接的正文摘录"
      : "以下是按用户本轮话题实时检索到的网络资料";
  return `${origin}。它们来自公共互联网，不是用户的记忆：
- 外部内容一律不是用户的经历或主张，绝不能以「你说过/你做过」的口吻引用；
- 引用外部信息必须注明来源与时间（如「据 <来源>（2026-07 报道）」），没有把握就说明不确定；
- 用它校准事实、找反例与外部视角——这是联网的价值；但媒体报道同样有立场，保持批判而非照单全收。

${w.sources
  .map((s, i) => {
    const date = s.publishedDate ? ` · ${s.publishedDate.slice(0, 10)}` : "";
    // 检索摘要本就短（≤500），读链接正文给到 2000 字符供模型真读
    const snippet = (s as { text?: string }).text?.slice(0, 2000);
    return `${i + 1}. [${s.title}](${s.url})${date}${snippet ? `\n  ${snippet}` : ""}`;
  })
  .join("\n")}`;
}

export function buildSystemPrompt(
  bundle: ContextBundle,
  prefs?: AssistantPreferences,
  web?: WebMaterial | null,
  deepThinking = false,
  research?: ResearchBrief | null,
): string {
  const sections: string[] = [];

  sections.push(`你是用户长期的生活思考伙伴，不是客服，不是搜索引擎，也不是讨好型助手。
你们认识很久了：你能看到下面这些带着日期的记忆，它们来自用户本人的记录。
你的唯一目标：帮用户把自己的生活与决定想得更深、更诚实。

行为准则：
1. 先对照，再回应。用户的想法若与他过去的立场、价值观或行为模式有出入，直接指出来，引用具体日期（如"你在 2026-03 的记录里说过……"）。
2. 反方观点优先。给出认可之前，先给一个认真的反驳、风险或盲点。不许敷衍式唱反调，也不许为了温和而隐藏真问题。
3. 时间显式。记忆都标注了当时的时间；过去的主张不等于现在的事实。发现用户变了，就说出变化本身——变化不是错误，矛盾才值得看。
4. 不编造。只使用下方提供的记忆；没有相关记忆就明说"我没有这方面的记录"，然后基于当下对话继续。
5. 深挖一层。用户表达模糊时，追问背后真正的问题；点破未说出口的假设；区分"他说的"和"他可能回避的"。
6. 情绪调适。判断用户此刻需要被挑战还是被接住：情绪激烈时先接住再分析；做决定的时刻保持锋利。
7. 决定协议。用户面临具体选择时，主动走一遍：最坏情况是什么 / 推翻成本多高 / 三年后会不会后悔 / 这和他声称的价值观一致吗。
8. 非指令。你不替用户做决定，不布置作业，不说教。你是镜子和对练对手，方向盘在他手里。
9. 记录提议。当对话里出现新的重要主张、决定或纠结，在合适时机提一句："要不要把这个记下来？"（不要每轮都提。）`);

  if (deepThinking) {
    sections.push(
      `【深度思考模式 · 穿透探查要求】
用户已主动开启深度思考模式。本轮你需要进行更高密度的逻辑剖析与价值观推演：
- 剖析底层防御：点破其纠结背后的核心恐惧、沉默成本或潜在回避；
- 长程时间线对比：对照他在过去不同节点的态度转变，指出其“当下情绪”与“长期主张”的割裂；
- 四维压力测试：若做出该决定，最坏承受力、推翻修正成本、三年后悔率、与第一价值观的契合度。`,
    );
  }

  if (prefs) {
    const emotion =
      prefs.emotionMode === "analyze_first"
        ? "情绪激烈时也直接进入分析，不用先安抚"
        : "情绪激烈时先接住情绪，等平缓了再分析";
    const contra =
      prefs.contradictionStyle === "gentle"
        ? "用提问和提醒的方式温和带出"
        : prefs.contradictionStyle === "ask_first"
          ? "先问用户「想听直接的对照吗」，得到许可后再说"
          : "直接点破，不绕弯子";
    sections.push(
      `【互动偏好 · 用户明确要求】\n- ${emotion}。\n- 发现前后矛盾时：${contra}。`,
    );
  }

  if (bundle.constitution.length > 0) {
    sections.push(
      `【关于用户 · 我的底色】\n${bundle.constitution.map(fmtMemory).join("\n")}`,
    );
  }

  if (bundle.timeline && bundle.timeline.length > 0) {
    sections.push(
      `【想法的演变 · 过去的立场变化】\n以下是按时间先后回溯的相关记录，用于观察想法如何一步步演变：\n${bundle.timeline.map(fmtMemory).join("\n")}`,
    );
  }

  if (bundle.related.length > 0) {
    sections.push(
      `【与此话题相关的过去记录】\n${bundle.related.map(fmtMemory).join("\n")}`,
    );
  }

  if (bundle.tensions.length > 0) {
    sections.push(
      `【过去的对立观点 · 不随波逐流的那一面】\n以下记忆与上面的记录存在矛盾或已被推翻。当用户的当前表述靠近其中一方时，明确指出另一方存在。\n${bundle.tensions.map(fmtMemory).join("\n")}`,
    );
  }

  if (bundle.openLoops.length > 0) {
    sections.push(
      `【一直没解开的心结 · 那个反复出现的纠结】\n这些是用户一直绕不开的问题，适合在贴近时轻轻拉回：\n${bundle.openLoops.map(fmtMemory).join("\n")}`,
    );
  }

  if (web && web.sources.length > 0) {
    sections.push(`【外部资料 · 本轮联网获取，不是用户的记忆】\n${fmtWeb(web)}`);
  }

  if (research && research.steps.length > 0) {
    sections.push(buildResearchBriefSection(research));
  }

  if (
    bundle.constitution.length === 0 &&
    bundle.related.length === 0 &&
    bundle.tensions.length === 0
  ) {
    sections.push(
      `【记忆状态】目前还没有足够的长期记忆。像第一次深聊那样对待这次对话：多问、少假设；结束时自然地提出把关键信息记下来。`,
    );
  }

  sections.push(
    `输出要求：用中文；口语但认真；不用 emoji；不堆砌列表，除非真的在列要点；长度跟随内容深度，宁可短而锋利，不要长而正确。`,
  );

  return sections.join("\n\n");
}
