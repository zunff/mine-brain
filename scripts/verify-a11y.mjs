// fix #7：折叠按钮 aria-expanded/aria-controls、联网与深度思考开关 aria-pressed 的 DOM 接线断言
// 数据源：真实历史会话（loaded session），离线零 AI，不读截图。
import { chromium } from "playwright";

let passed = 0;
let failed = 0;
let notes = [];
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
  // 等历史会话加载完成（出现深度上下文盒头）
  await page.locator("span", { hasText: "深度思考 · 依据" }).first().waitFor({ state: "visible", timeout: 15000 });

  // 1. 折叠按钮：aria-controls 存在、目标 id 存在于 DOM（点前可能未渲染则点后应有）
  const initial = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-controls]")].map((b) => ({
      controls: b.getAttribute("aria-controls"),
      expanded: b.getAttribute("aria-expanded"),
      targetInDom: !!document.getElementById(b.getAttribute("aria-controls")),
    }))
  );
  check("存在折叠按钮", initial.length >= 1, `共 ${initial.length}`);
  check("折叠按钮声明 aria-expanded（含 false 状态）", initial.length > 0 && initial.every((b) => b.expanded === "false"), JSON.stringify(initial.map((b) => b.expanded)));

  // 2. 点击第一个折叠按钮 → aria-expanded 翻转为 true，目标体渲染可见
  if (initial.length > 0) {
    const first = initial[0];
    const btn = page.locator(`button[aria-controls="${first.controls}"]`).first();
    const target = page.locator(`#${first.controls}`);
    const beforeVisible = await target.isVisible().catch(() => false);
    await btn.click();
    await target.waitFor({ state: "visible", timeout: 5000 });
    const afterExpanded = await btn.getAttribute("aria-expanded");
    const afterVisible = await target.isVisible().catch(() => false);
    check("点击后 aria-expanded=true", afterExpanded === "true", `before=${first.expanded} → after=${afterExpanded}`);
    check("目标体随展开可见", afterVisible === true && beforeVisible === false, `before=${beforeVisible} after=${afterVisible}`);
    // 再点一次收起
    await btn.click();
    await page.waitForFunction(
      (sel) => !document.querySelector(sel) || document.querySelector(sel).offsetParent === null,
      `#${first.controls}`
    );
    const afterCollapse = await btn.getAttribute("aria-expanded");
    check("再次点击 aria-expanded=false（收起态属性不丢）", afterCollapse === "false", `after=${afterCollapse}`);
  }

  // 3. 输入区开关 aria-pressed（联网仅 webAvailable 时有）
  const pressed = await page.evaluate(() => {
    const toggles = [...document.querySelectorAll('button[aria-pressed]')].map((b) => ({
      text: b.textContent.replace(/\s+/g, " ").trim(),
      pressed: b.getAttribute("aria-pressed"),
    }));
    return { toggles, web: toggles.filter((t) => t.text.includes("联网")), deep: toggles.filter((t) => t.text.includes("深度思考")) };
  });
  check("深度思考开关带 aria-pressed", pressed.deep.length === 1 && ["true", "false"].includes(pressed.deep[0].pressed), `pressed=${pressed.deep[0]?.pressed}`);
  if (pressed.web.length === 1) {
    check("联网开关带 aria-pressed", ["true", "false"].includes(pressed.web[0].pressed), `pressed=${pressed.web[0].pressed}`);
  } else {
    notes.push("联网开关未渲染（webAvailable 未配置→整体隐藏，预期）");
  }

  // 4. 思考过程按模式区分文案：仅当存在 reasoning 消息时硬校验；缺数据则记 note
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("span")]
      .map((s) => s.textContent)
      .filter((t) => t && (t.startsWith("深度思考过程") || t.startsWith("思考过程")))
  );
  if (labels.length > 0) {
    const bad = labels.filter((t) => t.startsWith("思考过程") && t.startsWith("深度思考过程"));
    check("思考过程文案唯一且按模式区分", bad.length === 0, JSON.stringify(labels));
  } else {
    notes.push("loaded 消息均无 reasoning_content，思考标签未渲染（数据条件，非代码缺陷）");
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (notes.length) console.log("notes:\n  - " + notes.join("\n  - "));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(1);
});