import { addEntry, insertMemory, listMemories, setTags } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const profiles = listMemories({ type: "profile", limit: 1 });
  return Response.json({ hasProfile: profiles.length > 0 });
}

interface Sections {
  whoami?: string;
  values?: string;
  focus?: string;
  history?: string;
  tensions?: string;
}

interface PostBody {
  sections?: Sections;
  useSample?: boolean;
}

/**
 * 首次引导：页面内完成「关于我」的种子写入，不要求用户改任何文件。
 * useSample=true 时写入内置示例档案，让大脑立刻可用。
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });

  const sections = body.useSample ? SAMPLE : cleanSections(body.sections);
  let count = 0;

  const save = (
    type: "profile" | "value" | "question",
    theme: string,
    title: string,
    content: string,
    importance: number,
    tags: string[],
  ) => {
    if (!content.trim()) return;
    const entryId = addEntry("onboarding", content);
    const id = insertMemory({
      type,
      title,
      content: content.trim(),
      importance,
      theme,
      sourceEntryId: entryId,
    });
    setTags(id, tags);
    count++;
  };

  save("profile", "self", "我是谁", sections.whoami ?? "", 0.95, ["自我介绍"]);
  save("value", "meaning", "我的价值观", sections.values ?? "", 0.9, ["价值观"]);
  save("profile", "career", "当前人生焦点", sections.focus ?? "", 0.85, ["人生阶段", "焦点"]);
  save("profile", "self", "塑造我的过往", sections.history ?? "", 0.8, ["过往"]);
  for (const t of splitTensions(sections.tensions ?? "")) {
    save("question", "self", "反复出现的纠结", t, 0.75, ["纠结", "开放回路"]);
  }

  return Response.json({ ok: true, count });
}

function cleanSections(s?: Sections): Required<Pick<Sections, "whoami" | "values">> & Sections {
  return {
    whoami: s?.whoami?.trim() ?? "",
    values: s?.values?.trim() ?? "",
    focus: s?.focus?.trim() ?? "",
    history: s?.history?.trim() ?? "",
    tensions: s?.tensions?.trim() ?? "",
  };
}

/** 按空行或「1. 2. 3.」拆分多条纠结 */
function splitTensions(text: string): string[] {
  return text
    .split(/\n\s*\n|\n(?=\d+[.、])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

const SAMPLE: Sections = {
  whoami:
    "（这是一份示例档案，帮你先跑起来，随时可以在记忆页修改思路后重新记录。）\n我是一个正在寻找工作与生活更好平衡的人。做事偏理性，习惯先把问题想清楚再行动，但也因此容易想太多、行动慢。在意成长，也在意身边的人。最近开始意识到：比起「做对每个决定」，更重要的是「诚实面对自己在意的到底是什么」。",
  values:
    "1. 诚实——对自己诚实优先于对别人交代\n2. 成长——每年都要感觉自己在变强，哪怕慢\n3. 关系——少数深度关系胜过一堆泛泛之交\n4. 自由——时间和注意力要握在自己手里\n5. 健康——身体是所有其他事情的底座",
  focus:
    "当前处在职业转型的犹豫期：手上的工作稳定但增长有限，心里想做更有创造性的事，又担心收入和确定性。同时想把生活节奏调回来：睡够、恢复运动、减少无效加班。",
  history:
    "过去几年最大的转折是从执行者转向带团队，那段时间学会了扛责任，也养成了过度负责、不敢放手的毛病。一次重要失败让我明白：我真正怕的不是失败本身，而是失败之后没人可以讨论。",
  tensions:
    "1. 稳定 vs 冒险：想要确定的收入，又羡慕做自己的事的人，每次想到这个就拖延。\n2. 对自己要求高 vs 容易内耗：标准定得高，达不到就自我批评，越批评越不想动。",
};
