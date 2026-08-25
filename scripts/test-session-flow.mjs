import { chromium } from "playwright";

async function test() {
  console.log("Testing new session creation & hydration...");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "msedge" });
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  // 1. Visit /settings and open Dialog to check for hydration errors
  console.log("Checking /settings dialogs...");
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  const reindexBtn = await page.$('button:has-text("全量重新向量化")');
  if (reindexBtn) {
    await reindexBtn.click();
    await page.waitForTimeout(300);
    const cancelBtn = await page.$('button:has-text("取消")');
    if (cancelBtn) await cancelBtn.click();
  }

  // 2. Visit / and create a new session
  console.log("Checking / new session creation...");
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

  const newChatBtn = await page.$('button:has-text("新对话")');
  if (newChatBtn) {
    await newChatBtn.click();
    await page.waitForTimeout(500);
    console.log("Clicked 新对话 successfully");
  }

  // Check if console has any hydration errors
  const hydrationErrors = consoleErrors.filter((e) =>
    e.includes("Hydration") || e.includes("cannot be a descendant of")
  );

  console.log("Console errors found:", consoleErrors.length);
  if (hydrationErrors.length > 0) {
    console.error("Hydration errors detected:", hydrationErrors);
    process.exit(1);
  } else {
    console.log("Zero hydration errors! All dialogs and sessions work properly.");
  }

  await browser.close();
}

test().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
