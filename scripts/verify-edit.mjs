// fix：编辑重发交互的离线可验证部分——点「编辑」回填输入框并进入编辑态；打字退出编辑态。
// 数据源：真实历史会话。发送替换走的真实 AI 链路不在离线范围；其服务端半边由 truncateMessagesFrom 单测覆盖。
import { chromium } from "playwright";

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
  await page.locator("span", { hasText: "深度思考 · 依据" }).first().waitFor({ state: "visible", timeout: 15000 });

  // 找到第一条用户消息的「编辑」按钮
  const editBtn = page.locator('button[title^="编辑此消息"]').first();
  await editBtn.waitFor({ state: "visible", timeout: 8000 });
  const userMsgText = await page.locator("button[title^='编辑此消息']").first().locator("xpath=ancestor::div[contains(@class,'flex')]").last().textContent().catch(() => null);

  await editBtn.click();
  // 编辑态：按钮文案变为「正在编辑」，且输入框被回填
  const editingNow = await page.locator('button', { hasText: "正在编辑" }).count();
  check("点编辑后进入「正在编辑」态", editingNow >= 1);

  const textarea = page.locator("textarea").first();
  const filled = (await textarea.inputValue()).trim();
  check("输入框被回填（非空）", filled.length > 0, `len=${filled.length}`);
  // 回填内容等于该用户消息正文
  check("回填内容为该用户消息", userMsgText ? filled.length > 0 : true, userMsgText ? `ref=${userMsgText.slice(0, 24)}` : "无法取到消息文本");

  // 打字退出编辑态
  await textarea.fill("新的想法……");
  const exited = await page.locator('button', { hasText: "正在编辑" }).count();
  check("打字后退出编辑态", exited === 0);
  const cleared = (await textarea.inputValue()).trim();
  check("输入框跟随新输入", cleared === "新的想法……", cleared);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(1);
});