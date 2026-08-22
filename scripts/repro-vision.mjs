// 复现应用形状的 vision 请求：system(宪章) + user(multipart)，定位丢图环节
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const KEY = /API_KEY=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim();
const BASE = /BASE_URL=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim();
const db = new DatabaseSync("data/mine-brain.db", { readOnly: true });

// 用真实 system prompt：从 settings 取 ai 配置不重要，直接构造与 buildSystemPrompt 相似的大 system
const sys =
  "你是用户长期的生活思考伙伴……\n【关于用户 · 宪章】\n- [profile · 2026-08-22] 我是一个正在寻找工作与生活更好平衡的人。\n行为准则：先对照，再回应……";

const imgRow = db
  .prepare("SELECT images FROM messages WHERE id = 13")
  .get();
const urls = JSON.parse(imgRow.images);

for (const [label, messages] of [
  ["A: system+multipart", [
    { role: "system", content: sys },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: urls[0] } },
        { type: "text", text: "这张图是什么？直接说。" },
      ],
    },
  ]],
  ["B: 仅 multipart（无 system）", [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: urls[0] } },
        { type: "text", text: "这张图是什么？直接说。" },
      ],
    },
  ]],
]) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: "x-preview-f-free",
      stream: false,
      temperature: 0.7,
      max_tokens: 2000,
      messages,
    }),
  });
  const data = await res.json();
  const c = data.choices?.[0]?.message?.content ?? `<status ${res.status}>`;
  console.log(`--- ${label}: ${c.slice(0, 120)}`);
}

// 追加变体：定位触发条件
import { readFileSync as rf2 } from "node:fs";
const urls2 = urls;
const variants = [
  ["C: 短system", [{ role: "system", content: "你是助手。" }, { role: "user", content: [{ type: "image_url", image_url: { url: urls2[0] } }, { type: "text", text: "图里什么颜色？一个词" }] }]],
  ["D: 长system+图在后", [{ role: "system", content: sys }, { role: "user", content: [{ type: "text", text: "这张图是什么？" }, { type: "image_url", image_url: { url: urls2[0] } }] }]],
];
for (const [label, messages] of variants) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "x-preview-f-free", stream: false, max_tokens: 800, messages }),
  });
  const data = await res.json();
  console.log(`--- ${label}: ${(data.choices?.[0]?.message?.content ?? "<err>").slice(0, 100)}`);
}
