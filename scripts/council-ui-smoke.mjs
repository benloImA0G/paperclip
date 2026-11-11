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
    const workTogether = page.locator("button:visible").filter({ hasText: "Work together" });
    const workVisibleBefore = await workTogether.first().isVisible().catch(() => false);
    if (viewport.name === "desktop") report("desktop Work together strip visible before Options opens", workVisibleBefore);
    if (viewport.name.startsWith("phone")) {
      report(`${viewport.name} Work together strip hidden before Options opens`, !workVisibleBefore);
      if (optionsExists) {
        const trigger = optionsButton.first();
        await trigger.click().catch(() => {});
        const sheet = page.locator("#council-options-popover");
        const visible = await sheet.isVisible().catch(() => false);
        const rect = visible ? await sheet.evaluate((element) => {
          const r = element.getBoundingClientRect();
          const nav = document.querySelector(".mobile-bottom-nav");
          const textarea = document.querySelector(".council-thread-shell textarea");
          return { width: r.width, height: r.height, left: r.left, right: r.right, bottom: r.bottom, navTop: nav?.getBoundingClientRect().top ?? innerHeight, textareaTop: textarea?.getBoundingClientRect().top ?? Infinity };
        }) : null;
        const fits = !!rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewport.width && rect.bottom <= rect.navTop && ((rect.textareaTop >= 0 && rect.textareaTop <= viewport.height) || rect.bottom <= rect.textareaTop);
        report(`${viewport.name} Options sheet fits viewport/nav and leaves composer top visible`, visible && fits, rect ? `left ${Math.round(rect.left)}, right ${Math.round(rect.right)}, bottom ${Math.round(rect.bottom)}, nav ${Math.round(rect.navTop)}` : "sheet missing");
        report(`${viewport.name} Work together strip visible after Options opens`, await workTogether.first().isVisible().catch(() => false));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
        report(`${viewport.name} Options Escape closes sheet and restores focus`, await sheet.count() === 0 && await trigger.evaluate((element) => element === document.activeElement).catch(() => false));
      } else {
        report(`${viewport.name} Options sheet fits viewport/nav and leaves composer top visible`, false, "button missing");
        report(`${viewport.name} Work together strip visible after Options opens`, false, "button missing");
        report(`${viewport.name} Options Escape closes sheet and restores focus`, false, "button missing");
      }

      const seatsButton = page.getByRole("button", { name: /^\d+ seats?$/ }).first();
      if (await seatsButton.count()) {
        const before = await seatsButton.getAttribute("aria-expanded");
        await seatsButton.click().catch(() => {});
        const after = await seatsButton.getAttribute("aria-expanded");
        const composerRect = textareaExists ? await textarea.boundingBox() : null;
        report(`${viewport.name} Seats disclosure toggles aria-expanded`, before !== after && after === "true");
        report(`${viewport.name} Composer remains inside viewport after expanding seats`, !!composerRect && composerRect.y + composerRect.height <= viewport.height, composerRect ? `bottom ${Math.round(composerRect.y + composerRect.height)}px` : "textarea missing");
        await seatsButton.click().catch(() => {});
      } else {
        report(`${viewport.name} Seats disclosure toggles aria-expanded`, false, "disclosure missing");
        report(`${viewport.name} Composer remains inside viewport after expanding seats`, false, "disclosure missing");
      }

      const messageAction = page.locator('button[aria-label="Message actions"]:visible').first();
      if (await messageAction.count()) {
        const triggerRect = await messageAction.boundingBox();
        await messageAction.click().catch(() => {});
        const menuRects = await messageAction.evaluate((element) => {
          const container = element.parentElement;
          return [...(container?.querySelectorAll("button") ?? [])].filter((button) => button !== element && button.getClientRects().length).map((button) => {
            const r = button.getBoundingClientRect(); return { left: r.left, right: r.right };
          });
        });
        report(`${viewport.name} Message actions trigger is inside viewport horizontally`, !!triggerRect && triggerRect.x >= 0, triggerRect ? `left ${Math.round(triggerRect.x)}px` : "trigger missing");
        report(`${viewport.name} Message actions menu items fit viewport`, menuRects.length > 0 && menuRects.every((r) => r.left >= 0 && r.right <= viewport.width), `${menuRects.length} visible item(s)`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
        report(`${viewport.name} Message actions Escape closes menu and restores focus`, await messageAction.evaluate((element) => element.getAttribute("aria-expanded") === "false" && element === document.activeElement).catch(() => false));
      } else {
        report(`${viewport.name} Message actions trigger is inside viewport horizontally`, false, "no messages/actions");
        report(`${viewport.name} Message actions menu items fit viewport`, false, "no messages/actions");
        report(`${viewport.name} Message actions Escape closes menu and restores focus`, false, "no messages/actions");
      }
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
        const formatSelect = dialog.getByRole("combobox", { name: "Format" });
        const memoryText = dialog.getByRole("textbox", { name: "Memory text" });
        const help = dialog.locator("#memory-import-help");
        const assertFormatState = async (format, name) => {
          const isOpen = await dialog.isVisible().catch(() => false);
          const selected = await formatSelect.inputValue().catch(() => "");
          const helpText = await help.innerText().catch(() => "");
          const matches = format === "markdown" ? helpText.includes("Start each memory with a line like") : helpText.includes("A list of entries: title and body are required");
          report(`${viewport.name} Memory Import ${name} keeps dialog open and help matches ${format}`, isOpen && selected === format && matches, `selected ${selected}`);
        };
        for (let index = 0; index < 3; index++) {
          await formatSelect.selectOption("markdown");
          await assertFormatState("markdown", `format change ${index + 1}`);
          await formatSelect.selectOption("json");
          await assertFormatState("json", `format change ${index + 1}`);
        }
        await formatSelect.click();
        await formatSelect.focus();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await assertFormatState("markdown", "keyboard format change");
        await memoryText.fill("test");
        await formatSelect.selectOption("json");
        const preserved = await memoryText.inputValue().catch(() => "");
        await assertFormatState("json", "format change after text entry");
        report(`${viewport.name} Memory Import text preserved across format change`, preserved === "test", `text ${preserved}`);
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
