// 视觉/截图不可用（主人无视觉能力）——本脚本只用 DOM 文本与结构断言验证
// 目标：fix #5「深度思考 vs 普通管道」上下文盒 UI 文案与结构性差异
// 数据源：真实历史会话（loaded session 同时含 非深度消息(5条记忆/0 traces) 与 深度消息(6条记忆/2 traces)），离线零 AI。
import { chromium } from "playwright";

const DEEP_HEADER = "深度思考 · 依据 6 条记忆与 2 类检索";
const NON_DEEP_HEADER = "本轮检索依据 · 5 条历史记忆";
const THEMES_SUFFIX = "· 关联生活域: meaning / self";
const SECTION_TITLE = "本轮检索依据";
const MEMORIES_TITLE = "调取的长期记忆与信念明细";
const TRACE_MEM = "核心宪章与相关记忆探查";
const TRACE_TL = "信念演进与未解纠结溯源";
const TRACE_MEM_COUNT = "12 条";
const TRACE_TL_COUNT = "1 条";

let passed = 0;
let failed = 0;
function check(label, ok, extra = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}${extra ? "  [" + extra + "]" : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? "  [" + extra + "]" : ""}`); }
}

async function main() {
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: "msedge" }); }
  catch { try { browser = await chromium.launch({ headless: true, channel: "chrome" }); } catch { browser = await chromium.launch({ headless: true }); } }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.locator("span", { hasText: DEEP_HEADER }).first().waitFor({ state: "visible", timeout: 15000 });

  console.log("\n== 1. 两个上下文盒并排存在（深 / 非深 各一） ==");
  check("深度思考 头文案", (await page.locator("span", { hasText: DEEP_HEADER }).count()) >= 1);
  check("普通 头文案", (await page.locator("span", { hasText: NON_DEEP_HEADER }).count()) >= 1);
  const themesCount = await page.locator("span", { hasText: THEMES_SUFFIX }).count();
  check("深度盒带 生活域后缀", themesCount >= 1);

  console.log("\n== 2. 展开【深度思考】盒 → 应出现 trace 分类区 ==");
  // 关键：按钮 with hasText 匹配整段文案，非深度盒按钮不含“深度思考”，不会误点
  await page.locator("button", { hasText: DEEP_HEADER }).first().click();
  await page.locator("span", { hasText: SECTION_TITLE }).first().waitFor({ state: "visible", timeout: 8000 });
  check("trace 分类区标题「本轮检索依据」", (await page.locator("span", { hasText: SECTION_TITLE }).count()) >= 1);

  const memTrace = await page.locator("span", { hasText: TRACE_MEM }).count();
  const tlTrace = await page.locator("span", { hasText: TRACE_TL }).count();
  check("trace: 核心宪章与相关记忆探查", memTrace >= 1);
  check("trace: 信念演进与未解纠结溯源", tlTrace >= 1);
  check("trace 条数徽标 trace_mem=12", (await page.locator("span", { hasText: TRACE_MEM_COUNT }).count()) >= 1);
  check("trace 条数徽标 trace_timeline=1", (await page.locator("span", { hasText: TRACE_TL_COUNT }).count()) >= 1);
  check("记忆卡片明细区标题", (await page.locator("span", { hasText: MEMORIES_TITLE }).count()) >= 1);

  console.log("\n== 3. 展开【非深度】盒 → 不应出现 trace 分类区 ==");
  await page.locator("button", { hasText: NON_DEEP_HEADER }).first().click();
  // 「本轮检索依据」作为独立 span（exact）只应来自 trace 区标题；非深度头文案“本轮检索依据 · 5 条”是同一 span 但带后缀
  const exactSectionCount = await page.evaluate(() => {
    const spans = [...document.querySelectorAll("span")].filter((s) => s.textContent?.trim() === "本轮检索依据");
    return spans.length;
  });
  check("非深度盒无可展开 trace 区（exact 标题仍只有 1 个）", exactSectionCount === 1);
  check("非深度记忆卡片区仍可见", (await page.locator("span", { hasText: MEMORIES_TITLE }).count()) >= 1);

  console.log("\n== 4. 侧栏含最近会话标题 ==");
  // 会话项是 <div> 内的截断 span（非 button）；先等列表渲染完成再断言，避免 fetch 竞态
  const sessionSpan = page.locator("span", { hasText: "最近 AI 编程工具这个领域有什" }).first();
  await sessionSpan.waitFor({ state: "visible", timeout: 12000 });
  check("侧栏会话项「最近 AI 编程工具这个领域有什」", (await sessionSpan.count()) >= 1);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(1);
});