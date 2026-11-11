// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Memory } from "./Memory";
import type { MemoryEntry } from "../api/memory";

const mock = vi.hoisted(() => ({ import: vi.fn(), entries: [] as import("../api/memory").MemoryEntry[], list: vi.fn(), getSettings: vi.fn(), setSettings: vi.fn(), create: vi.fn(), update: vi.fn(), withdraw: vi.fn(), restore: vi.fn(), approve: vi.fn(), tidy: vi.fn(), context: vi.fn(), merge: vi.fn(), supersede: vi.fn(), history: vi.fn(), related: vi.fn(), pushToast: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: mock.pushToast }) }));
vi.mock("../api/memory", () => ({ memoryApi: mock }));
const entry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({ id: "1", companyId: "company-1", kind: "reference", title: "Launch checklist", body: "Details", sourceUrl: null, sourceLabel: null, tags: [], pinned: false, status: "active", originKind: "manual", originRef: null, createdByLabel: "Alex", withdrawnReason: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", withdrawnAt: null, supersedesId: null, supersededById: null, lastUsedAt: null, useCount: 0, ...overrides });
let root: Root; let container: HTMLDivElement; let client: QueryClient;
async function waitFor(assertion: () => void) { let last: unknown; for (let i = 0; i < 100; i++) { try { assertion(); return; } catch (error) { last = error; } await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); } throw last; }
function button(text: string) { const el = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text); if (!el) throw Error(`Missing button ${text}`); return el; }
async function click(text: string) { await act(async () => button(text).click()); }
function change(el: HTMLInputElement | HTMLTextAreaElement, value: string) { const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set; setter?.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><Memory /></QueryClientProvider>)); await waitFor(() => expect(mock.list).toHaveBeenCalled()); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.entries = []; vi.clearAllMocks();
  mock.import.mockResolvedValue({ created: 5, skippedDuplicates: 1, skippedInvalid: [{ index: 0, reason: "bad" }, { index: 1, reason: "bad" }] });
  mock.getSettings.mockResolvedValue({ autoApprove: true });
  mock.setSettings.mockImplementation(async (_company, autoApprove) => ({ autoApprove }));
  mock.tidy.mockResolvedValue({ duplicates: [], stale: [] });
  mock.context.mockResolvedValue({ text: "Agent context", entries: [] });
  mock.history.mockResolvedValue({ entries: [entry({ id: "old", title: "Old version" })] });
  mock.related.mockResolvedValue({ entries: [] });
  mock.merge.mockResolvedValue(entry());
  mock.supersede.mockResolvedValue(entry());
  mock.list.mockImplementation(async (_company, filters) => ({ entries: mock.entries.filter((e) => filters.status === "pending" ? e.status === "pending" : filters.status === "all" ? e.status !== "pending" : e.status === "active").filter((e) => !filters.query || e.title.toLowerCase().includes(filters.query.toLowerCase())) }));
  mock.create.mockImplementation(async (_company, input) => { const item = entry(input); mock.entries.push(item); return item; });
  mock.update.mockImplementation(async (_company, id, input) => { const item = mock.entries.find((e) => e.id === id)!; Object.assign(item, input); return item; });
  mock.withdraw.mockImplementation(async (_company, id) => { const item = mock.entries.find((e) => e.id === id)!; item.status = "withdrawn"; return item; });
  mock.restore.mockImplementation(async (_company, id) => { const item = mock.entries.find((e) => e.id === id)!; item.status = "active"; return item; });
  mock.approve.mockImplementation(async (_company, id) => { const item = mock.entries.find((e) => e.id === id)!; item.status = "active"; return item; });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
describe("Memory", () => {
  it("imports text and shows the result", async () => {
    await render(); await click("Import");
    await act(async () => change(container.querySelector('textarea')!, '[{"title":"Example","body":"Details"}]'));
    const dialog = container.querySelector('[role="dialog"]')!;
    await act(async () => [...dialog.querySelectorAll("button")].find((el) => el.textContent === "Import")!.click());
    await waitFor(() => expect(container.textContent).toContain("Imported 5 as pending, 1 duplicate skipped, 2 invalid"));
    expect(mock.import).toHaveBeenCalledWith("company-1", { format: "json", text: '[{"title":"Example","body":"Details"}]' });
  });
  it("shows related entries and selects a related title", async () => {
    const second = entry({ id: "2", title: "Launch plan" });
    mock.entries = [entry(), second];
    mock.related.mockImplementation(async (_company, id) => ({ entries: id === "1" ? [second] : [] }));
    await render(); await waitFor(() => expect(button("Launch checklist")).toBeTruthy());
    await click("Launch checklist");
    await waitFor(() => expect(container.textContent).toContain("Related"));
    const related = [...container.querySelectorAll("li button")].find((el) => el.textContent === "Launch plan") as HTMLButtonElement;
    expect(related).toBeTruthy();
    await act(async () => related.click());
    await waitFor(() => expect(mock.related).toHaveBeenCalledWith("company-1", "2"));
    await waitFor(() => expect(container.textContent).toContain("No related entries"));
  });
  it("shows loading and empty states for related entries", async () => {
    mock.entries = [entry()];
    let resolve!: (value: { entries: MemoryEntry[] }) => void;
    mock.related.mockReturnValue(new Promise((done) => { resolve = done; }));
    await render(); await waitFor(() => expect(button("Launch checklist")).toBeTruthy());
    await click("Launch checklist");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Loading related…");
    await act(async () => resolve({ entries: [] }));
    await waitFor(() => expect(container.textContent).toContain("No related entries"));
    expect(container.textContent).not.toContain("Loading related…");
  });
  it("toggles automatic approval", async () => {
    await render(); await waitFor(() => expect(button("Auto-approve: On").disabled).toBe(false));
    await click("Auto-approve: On");
    await waitFor(() => expect(button("Auto-approve: Off")).toBeTruthy());
    expect(mock.setSettings).toHaveBeenCalledWith("company-1", false);
  });
  it("merges duplicates and withdraws stale entries", async () => {
    mock.entries = [entry(), entry({ id: "2", title: "Similar" })];
    mock.tidy.mockResolvedValue({ duplicates: [{ ids: ["1", "2"], reason: "Similar notes", suggestedTitle: "Combined", suggestedBody: "Both" }], stale: [entry()] });
    await render(); await waitFor(() => expect(button("Tidy up2")).toBeTruthy()); await click("Tidy up2"); await waitFor(() => expect(container.textContent).toContain("Similar notes"));
    await click("Merge into one"); await waitFor(() => expect(mock.merge).toHaveBeenCalledWith("company-1", { ids: ["1", "2"], title: "Combined", body: "Both" }));
    const panel = [...container.querySelectorAll("section")].find((el) => el.textContent?.includes("Not used for 60 days"))!;
    await act(async () => [...panel.querySelectorAll("button")].find((el) => el.textContent === "Withdraw")!.click());
    await waitFor(() => expect(mock.withdraw).toHaveBeenCalledWith("company-1", "1"));
  });
  it("shows usage, replaces an entry and loads its history", async () => {
    mock.entries = [entry({ useCount: 3, lastUsedAt: "2026-01-02T00:00:00Z" })]; await render();
    await waitFor(() => expect(container.textContent).toContain("Used 3 times - last used"));
    await click("History"); await waitFor(() => expect(container.textContent).toContain("Old version"));
    await click("Replace with new version"); await click("Save"); await waitFor(() => expect(mock.supersede).toHaveBeenCalledWith("company-1", "1", expect.objectContaining({ title: "Launch checklist" })));
  });
  it("previews agent context for the search", async () => {
    await render(); await click("What agents see"); await waitFor(() => expect(container.textContent).toContain("13 of 1,800 characters"));
    await act(async () => change(container.querySelector('input[aria-label="Search memory"]')!, "launch"));
    await waitFor(() => expect(mock.context).toHaveBeenCalledWith("company-1", "launch"));
  });
  it("filters loaded entries by tags and clears the selection", async () => {
    mock.entries = [entry({ title: "Alpha", tags: ["shared", "alpha"] }), entry({ id: "2", title: "Beta", tags: ["shared", "beta"] })];
    await render(); await waitFor(() => expect(button("Alpha")).toBeTruthy());
    await click("shared"); await click("alpha");
    expect(button("Alpha")).toBeTruthy(); expect(container.textContent).not.toContain("Beta");
    expect(button("alpha").getAttribute("aria-pressed")).toBe("true");
    await click("Clear"); expect(button("Beta")).toBeTruthy();
    expect(mock.list.mock.calls.every(([, filters]) => !filters.tag)).toBe(true);
  });
  it("sorts pinned and updated entries, recently used, and oldest", async () => {
    mock.entries = [entry({ title: "Older", updatedAt: "2026-01-01T00:00:00Z", lastUsedAt: "2026-03-01T00:00:00Z" }), entry({ id: "2", title: "Newer", updatedAt: "2026-02-01T00:00:00Z" }), entry({ id: "3", title: "Pinned", pinned: true, updatedAt: "2025-01-01T00:00:00Z", lastUsedAt: "2026-02-01T00:00:00Z" })];
    await render(); await waitFor(() => expect(button("Pinned")).toBeTruthy());
    const titles = () => [...container.querySelectorAll("article h2")].map((el) => el.textContent);
    expect(titles()).toEqual(["Pinned", "Newer", "Older"]);
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "recently-used"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(titles()).toEqual(["Older", "Pinned", "Newer"]);
    await act(async () => { select.value = "oldest"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(titles()).toEqual(["Pinned", "Older", "Newer"]);
  });
  it("shows example ideas when empty", async () => { await render(); await waitFor(() => expect(container.textContent).toContain("Our launch checklist")); expect(container.textContent).toContain("Preferred answer style"); });
  it("adds an entry", async () => { await render(); await click("+ Add to memory"); const title = [...container.querySelectorAll("label")].find((el) => el.textContent?.startsWith("Title"))!.querySelector("input")!; await act(async () => change(title, "Launch checklist")); await click("Save"); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); expect(mock.create).toHaveBeenCalledOnce(); });
  it("searches after a debounce", async () => { mock.entries = [entry()]; await render(); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); await act(async () => change(container.querySelector('input[aria-label="Search memory"]')!, "missing")); await waitFor(() => expect(mock.list).toHaveBeenCalledWith("company-1", expect.objectContaining({ query: "missing" }))); await waitFor(() => expect(container.textContent).not.toContain("Launch checklist")); });
  it("pins, withdraws and restores an entry", async () => { mock.entries = [entry()]; await render(); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); await click("Pin"); await waitFor(() => expect(button("Unpin")).toBeTruthy()); await click("Withdraw"); await click("Confirm withdrawal"); await waitFor(() => expect(container.textContent).not.toContain("Launch checklist")); const toggle = [...container.querySelectorAll("label")].find((el) => el.textContent?.includes("Show withdrawn"))!.querySelector("input")!; await act(async () => toggle.click()); await waitFor(() => expect(button("Restore")).toBeTruthy()); await click("Restore"); await waitFor(() => expect(button("Unpin")).toBeTruthy()); });
  it("shows and approves pending entries", async () => { mock.entries = [entry({ status: "pending", title: "Agent note", createdByLabel: "Agent" })]; await render(); await waitFor(() => expect(container.textContent).toContain("Waiting for approval")); await click("Approve"); await waitFor(() => expect(container.textContent).not.toContain("Waiting for approval")); expect(container.textContent).toContain("Agent note"); expect(mock.approve).toHaveBeenCalledOnce(); });
});
