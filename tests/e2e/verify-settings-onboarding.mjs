// fix：设置页「初始画像」卡片状态一致性——加载中不渲染误导文案、页面回归后自动重取。
// 只断言结构（不依赖本机数据库是哪一种画像状态），离线零 AI、不读截图。
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

  await page.goto("http://localhost:3000/settings", { waitUntil: "domcontentloaded" });
  await page.locator("h2", { hasText: "初始画像" }).first().waitFor({ state: "visible", timeout: 15000 });

  // 卡片按钮最终必须停在一个真实标签上（不是永久的「加载中…」）
  const btn = page.locator("button", { hasText: /建立初始画像|加载中/ }).first();
  await page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        /建立初始画像|加载中/.test(b.textContent || "")
      );
      return el && !/加载中/.test(el.textContent || "");
    },
    { timeout: 8000 },
  ).catch(() => {});
  const finalLabel = await btn.textContent();
  check("卡片按钮已停驻（无加载中占位残留）", finalLabel === "建立初始画像" || finalLabel === "重新建立初始画像", finalLabel?.trim() ?? "null");

  // 描述文案应为三种真实态之一，而非加载占位
  const desc = await page
    .locator("h2", { hasText: "初始画像" })
    .first()
    .locator("xpath=ancestor::section//p")
    .first()
    .textContent()
    .catch(() => "");
  const okDesc = !desc.includes("正在读取画像状态") &&
    (desc.startsWith("已建立基准") || desc.startsWith("之前选择了跳过") || desc.startsWith("尚未建立"));
  check("描述已停驻在真实状态文案", okDesc, desc.slice(0, 16));

  // 只有一个「初始画像」卡片（双 fetch 不产生重复）
  check("仅一个初始画像卡片", (await page.locator("h2", { hasText: "初始画像" }).count()) === 1);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("SCRIPT ERROR:", e.message);
  process.exit(1);
});