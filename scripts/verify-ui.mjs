import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("playwright-screenshots");
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function run() {
  console.log("Launching browser for comprehensive visual inspection...");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "msedge" });
  } catch {
    try {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
  }

  const errors = [];
  const logPageErrors = (page, contextName) => {
    page.on("pageerror", (err) => {
      console.error(`[${contextName}] PageError:`, err.message);
      errors.push({ context: contextName, type: "pageerror", message: err.message });
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.warn(`[${contextName}] ConsoleError:`, msg.text());
        // Filter out harmless extension/favicon noise if any
        if (!msg.text().includes("favicon.ico")) {
          errors.push({ context: contextName, type: "console.error", message: msg.text() });
        }
      }
    });
  };

  const routes = [
    { path: "/", name: "chat" },
    { path: "/memories", name: "memories" },
    { path: "/settings", name: "settings" },
    { path: "/onboarding", name: "onboarding" },
  ];

  // 1. Desktop Context (1280x800)
  console.log("\n--- [1] Desktop Screenshots (1280x800) ---");
  const desktopCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const desktopPage = await desktopCtx.newPage();
  logPageErrors(desktopPage, "Desktop");

  for (const r of routes) {
    console.log(`[Desktop] Navigating to ${r.path}`);
    await desktopPage.goto(`http://localhost:3000${r.path}`, { waitUntil: "networkidle" });
    await desktopPage.waitForTimeout(600);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, `desktop_${r.name}_default.png`),
      fullPage: false,
    });
  }

  // Inspect Chat page interactions on Desktop
  console.log("[Desktop] Inspecting chat session interactions...");
  await desktopPage.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(600);

  // Check if there are sessions in the sidebar to click
  const sessionItems = await desktopPage.$$('aside .space-y-1 > div');
  if (sessionItems.length > 0) {
    console.log(`[Desktop] Found ${sessionItems.length} existing sessions, clicking the first one...`);
    await sessionItems[0].click();
    await desktopPage.waitForTimeout(800);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, "desktop_chat_with_messages.png"),
      fullPage: false,
    });

    // Check cognitive probes & reasoning toggles if present
    const contextToggles = await desktopPage.$$('button:has-text("多维认知探针")');
    if (contextToggles.length > 0) {
      console.log("[Desktop] Toggling context accordion...");
      await contextToggles[0].click();
      await desktopPage.waitForTimeout(400);
      await desktopPage.screenshot({
        path: path.join(OUT_DIR, "desktop_chat_context_expanded.png"),
        fullPage: false,
      });
    }

    const reasoningToggles = await desktopPage.$$('button:has-text("思考过程")');
    if (reasoningToggles.length > 0) {
      console.log("[Desktop] Toggling reasoning accordion...");
      await reasoningToggles[0].click();
      await desktopPage.waitForTimeout(400);
      await desktopPage.screenshot({
        path: path.join(OUT_DIR, "desktop_chat_reasoning_expanded.png"),
        fullPage: false,
      });
    }
  }

  // Test Sidebar Toggle
  console.log("[Desktop] Testing sidebar collapse button...");
  const collapseBtn = await desktopPage.$('button[title*="侧边栏"], button[title*="收起侧边栏"], button:has(svg.lucide-panel-left-close), button:has(svg.lucide-panel-left)');
  if (collapseBtn) {
    await collapseBtn.click();
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, "desktop_chat_sidebar_collapsed.png"),
      fullPage: false,
    });
    // restore sidebar
    await collapseBtn.click();
    await desktopPage.waitForTimeout(300);
  }

  // Test /memories interactions (filters, modal)
  console.log("[Desktop] Testing /memories interactions...");
  await desktopPage.goto("http://localhost:3000/memories", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(600);

  const addMemoryBtn = await desktopPage.$('button:has-text("新增记忆"), button:has-text("添加")');
  if (addMemoryBtn) {
    await addMemoryBtn.click();
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, "desktop_memories_dialog.png"),
      fullPage: false,
    });
    // Close dialog
    const closeDialogBtn = await desktopPage.$('button:has-text("取消"), button:has-text("关闭")');
    if (closeDialogBtn) await closeDialogBtn.click();
  }

  // Test theme rendering on /settings and /
  console.log("\n--- [2] Theme Variations Screenshots ---");
  for (const th of ["parchment", "forest", "roast", "eink"]) {
    console.log(`[Theme] Testing theme: ${th}`);
    await desktopPage.evaluate((themeName) => {
      localStorage.setItem("mb_theme", themeName);
      document.documentElement.setAttribute("data-theme", themeName);
    }, th);
    await desktopPage.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, `desktop_settings_${th}.png`),
    });

    await desktopPage.goto("http://localhost:3000/", { waitUntil: "networkidle" });
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({
      path: path.join(OUT_DIR, `desktop_chat_${th}.png`),
    });
  }

  // Restore obsidian theme
  await desktopPage.evaluate(() => {
    localStorage.setItem("mb_theme", "obsidian");
    document.documentElement.setAttribute("data-theme", "obsidian");
  });

  await desktopCtx.close();

  // 3. Mobile Context (390x844, Touch)
  console.log("\n--- [3] Mobile Screenshots (390x844 iPhone 14) ---");
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileCtx.newPage();
  logPageErrors(mobilePage, "Mobile");

  for (const r of routes) {
    console.log(`[Mobile] Navigating to ${r.path}`);
    await mobilePage.goto(`http://localhost:3000${r.path}`, { waitUntil: "networkidle" });
    await mobilePage.waitForTimeout(500);
    await mobilePage.screenshot({
      path: path.join(OUT_DIR, `mobile_${r.name}_default.png`),
      fullPage: false,
    });
  }

  // Test Mobile Session Drawer on Chat
  console.log("[Mobile] Opening history drawer on /");
  await mobilePage.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(500);
  const mobileDrawerBtn = await mobilePage.$('button:has-text("历史"), button:has-text("对话"), button[title*="历史"]');
  if (mobileDrawerBtn) {
    await mobileDrawerBtn.click();
    await mobilePage.waitForTimeout(400);
    await mobilePage.screenshot({
      path: path.join(OUT_DIR, "mobile_chat_drawer_opened.png"),
    });
  }

  await mobileCtx.close();
  await browser.close();

  console.log("\n--- Visual Verification Completed ---");
  console.log(`Total errors captured: ${errors.length}`);
  if (errors.length > 0) {
    console.log("Error details:", JSON.stringify(errors, null, 2));
  } else {
    console.log("Zero runtime errors detected across all pages and viewports!");
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
