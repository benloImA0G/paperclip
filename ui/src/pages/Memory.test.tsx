// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Memory } from "./Memory";
import type { MemoryEntry } from "../api/memory";

const mock = vi.hoisted(() => ({ entries: [] as import("../api/memory").MemoryEntry[], list: vi.fn(), create: vi.fn(), update: vi.fn(), withdraw: vi.fn(), restore: vi.fn(), approve: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => null }));
vi.mock("../api/memory", () => ({ memoryApi: mock }));
const entry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({ id: "1", companyId: "company-1", kind: "reference", title: "Launch checklist", body: "Details", sourceUrl: null, sourceLabel: null, tags: [], pinned: false, status: "active", originKind: "manual", originRef: null, createdByLabel: "Alex", withdrawnReason: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", withdrawnAt: null, ...overrides });
let root: Root; let container: HTMLDivElement; let client: QueryClient;
async function waitFor(assertion: () => void) { let last: unknown; for (let i = 0; i < 100; i++) { try { assertion(); return; } catch (error) { last = error; } await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); } throw last; }
function button(text: string) { const el = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text); if (!el) throw Error(`Missing button ${text}`); return el; }
async function click(text: string) { await act(async () => button(text).click()); }
function change(el: HTMLInputElement | HTMLTextAreaElement, value: string) { const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set; setter?.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><Memory /></QueryClientProvider>)); await waitFor(() => expect(mock.list).toHaveBeenCalled()); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.entries = []; vi.clearAllMocks();
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
  it("shows example ideas when empty", async () => { await render(); await waitFor(() => expect(container.textContent).toContain("Our launch checklist")); expect(container.textContent).toContain("Preferred answer style"); });
  it("adds an entry", async () => { await render(); await click("+ Add to memory"); const title = [...container.querySelectorAll("label")].find((el) => el.textContent?.startsWith("Title"))!.querySelector("input")!; await act(async () => change(title, "Launch checklist")); await click("Save"); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); expect(mock.create).toHaveBeenCalledOnce(); });
  it("searches after a debounce", async () => { mock.entries = [entry()]; await render(); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); await act(async () => change(container.querySelector('input[aria-label="Search memory"]')!, "missing")); await waitFor(() => expect(mock.list).toHaveBeenCalledWith("company-1", expect.objectContaining({ query: "missing" }))); await waitFor(() => expect(container.textContent).not.toContain("Launch checklist")); });
  it("pins, withdraws and restores an entry", async () => { mock.entries = [entry()]; await render(); await waitFor(() => expect(container.textContent).toContain("Launch checklist")); await click("Pin"); await waitFor(() => expect(button("Unpin")).toBeTruthy()); await click("Withdraw"); await click("Confirm withdrawal"); await waitFor(() => expect(container.textContent).not.toContain("Launch checklist")); const toggle = [...container.querySelectorAll("label")].find((el) => el.textContent?.includes("Show withdrawn"))!.querySelector("input")!; await act(async () => toggle.click()); await waitFor(() => expect(button("Restore")).toBeTruthy()); await click("Restore"); await waitFor(() => expect(button("Unpin")).toBeTruthy()); });
  it("shows and approves pending entries", async () => { mock.entries = [entry({ status: "pending", title: "Agent note", createdByLabel: "Agent" })]; await render(); await waitFor(() => expect(container.textContent).toContain("Waiting for approval")); await click("Approve"); await waitFor(() => expect(container.textContent).not.toContain("Waiting for approval")); expect(container.textContent).toContain("Agent note"); expect(mock.approve).toHaveBeenCalledOnce(); });
});
