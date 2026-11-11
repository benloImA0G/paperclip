const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "/home/super/council-test/codex/node_modules/playwright/index.mjs");

const baseUrl = "http://127.0.0.1:3100";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/home/super/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const selfTest = process.argv.includes("--self-test");
const violations = [];
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 375, height: 812 },
  { name: "phone-390", width: 390, height: 844 },
];
const results = [];
const consoleErrors = [];
const failedRequests = [];
const knownExpectedErrors = new Set();

function report(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function isIgnoredUrl(url) {
  return /favicon\.ico(?:\?|$)/i.test(url) || /vite.*hmr|\/__vite_ping|ws:\/\//i.test(url);
}

function isModelsEndpoint(url) {
  return /\/council\/connections\/[^/]+\/models(?:\?|$)/i.test(url);
}

const browser = await chromium.launch({ headless: true, executablePath });
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.route("**/api/**", (route) => {
      const request = route.request();
      if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.continue();
      violations.push(`${request.method()} ${request.url()}`);
      return route.abort();
    });
    page.on("console", (message) => {
      const locationUrl = message.location().url;
      if (message.type() === "error" && isModelsEndpoint(locationUrl) && /422|unprocessable entity/i.test(message.text())) {
        const key = `${viewport.name}: ${locationUrl} (HTTP 422)`;
        if (!knownExpectedErrors.has(key)) console.log(`INFO known expected ${key} — vendor not reachable, user can type a model name`);
        knownExpectedErrors.add(key);
        return;
      }
      if (message.type() === "error" && !isIgnoredUrl(message.text())) consoleErrors.push(`${viewport.name}: ${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      if (!isIgnoredUrl(request.url()) && !violations.includes(`${request.method()} ${request.url()}`)) failedRequests.push(`${viewport.name}: ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
    });
    page.on("response", (response) => {
      if (response.status() === 422 && isModelsEndpoint(response.url())) {
        const key = `${viewport.name}: ${response.url()} (HTTP 422)`;
        if (!knownExpectedErrors.has(key)) console.log(`INFO known expected ${key} — vendor not reachable, user can type a model name`);
        knownExpectedErrors.add(key);
      } else if (response.status() >= 400 && !isIgnoredUrl(response.url())) {
        failedRequests.push(`${viewport.name}: ${response.url()} (HTTP ${response.status()})`);
      }
    });

    await page.goto(`${baseUrl}/BEN/council`, { waitUntil: "domcontentloaded" });
    if (selfTest) await page.evaluate(() => fetch("/api/council-smoke-self-test", { method: "POST" }).catch(() => {}));
    await page.locator(".council-rooms").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const roomButtons = page.locator(".council-rooms button[data-council-room-chip]");
    const roomCount = await roomButtons.count();
    let selectedRoom = false;
    if (roomCount) {
      let target = roomButtons.first();
      selectedRoom = await target.click().then(() => target.getAttribute("aria-pressed")).then((value) => value === "true").catch(() => false);
      await page.waitForTimeout(500);
    }
    report(`${viewport.name} Council existing room available/opened`, selectedRoom, `room buttons: ${roomCount}`);

    const optionsButton = page.getByRole("button", { name: "Message options" });
    const optionsExists = await optionsButton.count() > 0;
    const textarea = page.locator(".council-thread-shell textarea").first();
    const textareaExists = await textarea.count() > 0;
    report(`${viewport.name} Council composer textarea exists`, textareaExists);
    report(`${viewport.name} Council Options button exists`, optionsExists);
    if (viewport.name.startsWith("phone") && optionsExists) {
      await optionsButton.first().click().catch(() => {});
    }

    const documents = page.locator('button[aria-label^="Documents"]:visible');
    const documentsExists = await documents.count() > 0;
    report(`${viewport.name} Council Documents chip exists`, documentsExists);
    if (documentsExists) {
      await documents.first().click().catch(() => {});
      const settingsDialog = page.getByRole("dialog", { name: "Room settings" });
      const openedSettings = await settingsDialog.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
      const hasDocumentsHeading = openedSettings && await settingsDialog.getByRole("heading", { name: "Documents" }).count() > 0;
      report(`${viewport.name} Documents opens Room settings with Documents heading`, hasDocumentsHeading);
      if (openedSettings) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
      }
      report(`${viewport.name} Room settings closes with Escape`, openedSettings && await settingsDialog.count() === 0);
    } else {
      report(`${viewport.name} Documents opens Room settings with Documents heading`, false, "chip missing");
      report(`${viewport.name} Room settings closes with Escape`, false, "chip missing");
    }

    if (viewport.name.startsWith("phone")) {
      let geometryOk = false;
      let detail = "thread or composer missing";
      if (textareaExists) {
        const thread = page.locator(".council-message-thread");
        if (await thread.count()) {
          const [threadRect, composerRect] = await Promise.all([thread.boundingBox(), textarea.boundingBox()]);
          if (threadRect && composerRect) {
            geometryOk = threadRect.height >= viewport.height * 0.4 && threadRect.y + threadRect.height <= composerRect.y;
            detail = `thread ${Math.round(threadRect.height)}px, composer starts ${Math.round(composerRect.y)}px`;
          }
        }
      }
      report(`${viewport.name} Council thread does not overlap composer and is at least 40% viewport height`, geometryOk, detail);
    }

    await page.screenshot({ path: `/tmp/council-ui-smoke-${viewport.name}-council.png`, fullPage: false });
    await page.goto(`${baseUrl}/BEN/memory`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Memory", exact: true }).waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const hasEntries = await page.locator("main article").count() > 0;
    const hasEmptyState = await page.getByText("Nothing in memory yet", { exact: true }).count() > 0;
    report(`${viewport.name} Memory entries or empty state shown`, hasEntries || hasEmptyState, `entries: ${await page.locator("main article").count()}`);
    const importButton = page.getByRole("button", { name: "Import", exact: true });
    const importExists = await importButton.count() > 0;
    let dialogOpened = false;
    let focusRestored = false;
    if (importExists) {
      await importButton.click();
      const dialog = page.getByRole("dialog");
      dialogOpened = await dialog.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
      if (dialogOpened) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        focusRestored = await importButton.evaluate((element) => element === document.activeElement);
      }
    }
    report(`${viewport.name} Memory Import button opens dialog`, importExists && dialogOpened);
    report(`${viewport.name} Memory Import Escape closes dialog and restores focus`, dialogOpened && focusRestored);
    if (hasEntries) {
      const tagChips = page.locator("button[aria-pressed]").filter({ has: page.locator(":scope") });
      const hasTagRow = await page.locator("main").getByRole("button").count() > 0 && await page.locator("main").locator("div.flex.flex-wrap.gap-2 button").count() > 0;
      const sortExists = await page.locator("label").filter({ hasText: "Sort by" }).locator("select").count() > 0;
      report(`${viewport.name} Memory tag chips row exists when entries exist`, hasTagRow);
      report(`${viewport.name} Memory sort select exists when entries exist`, sortExists);
      void tagChips;
    }
    await page.screenshot({ path: `/tmp/council-ui-smoke-${viewport.name}-memory.png`, fullPage: false });
    await page.close();
  }
} finally {
  await browser.close();
}

for (const violation of violations) report(`attempted a write: ${violation}`, false);
console.log(`Attempted writes: ${violations.length}`);
for (const request of failedRequests) console.log(`FAILED REQUEST ${request}`);
for (const error of consoleErrors.slice(0, 10)) console.log(`CONSOLE ERROR ${error}`);
console.log(`SUMMARY ${results.filter((result) => result.passed).length} passed, ${results.filter((result) => !result.passed).length} failed`);
process.exitCode = results.some((result) => !result.passed) || failedRequests.length > 0 || consoleErrors.length > 0 ? 1 : 0;
