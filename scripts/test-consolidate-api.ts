// 诊断脚本：用真实会话内容复现整理调用的请求形状
import { DatabaseSync } from "node:sqlite";

const KEY = process.env.MINE_BRAIN_AI_API_KEY ?? "";
const BASE = "https://opencode.ai/zen/v1";

const db = new DatabaseSync("data/mine-brain.db", { readOnly: true });
const msgs = db.prepare("SELECT role, content FROM messages ORDER BY id").all();
const conversation = msgs
  .map((m) => `${m.role === "user" ? "用户" : "伙伴"}：${m.content}`)
  .join("\n\n");
const digest = "";

const userPrompt = `你在为一个人的「第二大脑」做记忆整理。下面是他与思考伙伴的一段对话，以及他已有的长期记忆清单。

任务：从对话中抽取值得长期记住的关于「他本人」的记忆。只提取真实出现的内容，禁止编造或过度推断。

已有记忆清单（id | 类型 | 内容摘要）：
（空）

抽取规则：
- type 取值：profile(关于我)/value(价值观)/claim(主张·信念)/decision(决定)/question(反复纠结的开放回路)/insight(洞察)/pattern(行为模式)
- content 用第一人称写（如"我……"），具体、可追溯，避免空话
- theme 取值：career/relationship/family/health/money/growth/meaning/self，不确定就填 self
- importance 0~1：日常吐槽 0.3 左右，重要决定与核心价值观 0.8+
- tags：2~5 个检索用关键词
- 宁缺毋滥：没有值得记的就返回空数组

对话内容：
<conversation>
${conversation}
</conversation>

只输出 JSON，格式：
{"items":[{"type":"...","title":"...","content":"...","theme":"...","importance":0.5,"tags":["..."]}],"session_summary":"一句话概括这段对话"}`;

console.log("prompt length:", userPrompt.length);

for (let i = 1; i <= 2; i++) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: "x-preview-f-free",
      stream: false,
      temperature: 0.2,
      max_tokens: 4000,
      messages: [
        { role: "system", content: "你是严谨的记忆整理员，只输出合法 JSON。" },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  console.log(`attempt ${i}: status=${res.status}`);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 200));
    continue;
  }
  const data = await res.json();
  console.log(
    "content head:",
    (data.choices?.[0]?.message?.content ?? "").slice(0, 150),
  );
}
