// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbProvider } from "../context/BreadcrumbContext";
import { ThemeProvider } from "../context/ThemeContext";
import { Council } from "./Council";

const api = vi.hoisted(() => ({
  comments: {} as Record<string, unknown[]>,
  runRound: vi.fn(), forkRoom: vi.fn(),
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }), useOptionalCompany: () => null }));
vi.mock("../api/council", () => ({ councilApi: {
  listRooms: vi.fn(async () => [{ id: "room-1", title: "First room" }, { id: "room-2", title: "Second room" }]),
  listArchivedRooms: vi.fn(async () => []),
  listSeats: vi.fn(async () => [
    { id: "seat-1", name: "Alice", kind: "vendor", connectionId: "conn-1", model: "model", role: "none", fallbacks: [], active: true },
    { id: "seat-2", name: "Bob", kind: "vendor", connectionId: "conn-2", model: "model", role: "none", fallbacks: [], active: true },
  ]),
  getBrief: vi.fn(async () => ({ brief: "" })), getWork: vi.fn(async () => ({ status: "idle", steps: [] })),
  getReliability: vi.fn(async () => null), listArtifacts: vi.fn(async () => []),
  getExportSetting: vi.fn(async () => ({ requireApproval: false })), listModels: vi.fn(async () => []),
  runRound: api.runRound, forkRoom: api.forkRoom,
} }));
vi.mock("../api/ai-connections", () => ({ aiConnectionsApi: { list: vi.fn(async () => ({ connections: [
  { id: "conn-1", grantId: "grant-1", name: "Cloud One", provider: "openai", routing: { kind: "cloud" } },
  { id: "conn-2", grantId: "grant-2", name: "Cloud Two", provider: "openai", routing: { kind: "cloud" } },
] })) } }));
vi.mock("../api/issues", () => ({ issuesApi: {
  get: vi.fn(async () => ({})), listComments: vi.fn(async (room: string) => api.comments[room] ?? []),
} }));

const reply = { id: "reply-1", authorUserId: "council-seat:seat-1", body: "A useful answer", createdAt: "2026-01-01T00:00:00Z", metadata: { councilReliability: { local: false } } };
const question = { id: "question-1", authorUserId: "user-1", body: "A question", createdAt: "2026-01-01T00:00:00Z" };
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function waitFor(assertion: () => void) {
  let last: unknown;
  for (let i = 0; i < 100; i++) {
    try { assertion(); return; } catch (error) { last = error; }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw last;
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}
function counts() {
  expect([...container.querySelectorAll("summary")].filter((el) => el.textContent?.trim() === "Teams ▾")).toHaveLength(1);
  expect([...container.querySelectorAll("button")].filter((el) => el.textContent?.trim() === "Check seats")).toHaveLength(1);
  expect([...container.querySelectorAll("p")].filter((el) => el.textContent?.includes("Prompts may be sent to a cloud provider"))).toHaveLength(1);
}
async function renderPage() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><Council /></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
  await waitFor(() => expect(container.textContent).toContain("A useful answer"));
}
async function click(label: string) { await act(async () => { button(label).click(); }); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.comments = { "room-1": [question, reply], "room-2": [question, { ...reply, id: "reply-2", body: "Second room answer" }] };
  api.runRound.mockReset().mockResolvedValue({ results: [] });
  api.forkRoom.mockReset().mockResolvedValue({ room: { id: "room-2" } });
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });

describe("Council page", () => {
  it("renders seats, reply footer, and one set of room controls", async () => {
    await renderPage();
    await waitFor(() => counts());
    expect(button("AliceCloud")).toBeTruthy();
    expect(button("BobCloud")).toBeTruthy();
    expect(container.textContent).toContain("Not fact-checked");
  });
  it("does not duplicate controls when switching rooms and back", async () => {
    await renderPage(); await waitFor(() => counts());
    await click("Second room"); await waitFor(() => expect(container.textContent).toContain("Second room answer")); counts();
    await click("First room"); await waitFor(() => expect(container.textContent).toContain("A useful answer")); counts();
  });
  it("shows first-use steps only while the room has no comments", async () => {
    api.comments["room-1"] = [];
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><Council /></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
    await waitFor(() => expect(container.textContent).toContain("1. Add a team"));
    api.comments["room-1"] = [question, reply];
    await act(async () => { await client.invalidateQueries({ queryKey: ["council", "company-1", "room-1", "comments"] }); });
    await waitFor(() => expect(container.textContent).toContain("A useful answer"));
    expect(container.textContent).not.toContain("1. Add a team");
  });
  it("asks the reply's seat again from that comment", async () => {
    await renderPage(); await click("Ask again");
    await waitFor(() => expect(api.runRound).toHaveBeenCalledWith("company-1", "room-1", { mode: "ask", seatId: "seat-1", repeatLast: true, repeatFromCommentId: "reply-1" }, expect.any(AbortSignal)));
  });
  it("forks from the reply", async () => {
    await renderPage(); await click("Fork from here");
    await waitFor(() => expect(api.forkRoom).toHaveBeenCalledWith("company-1", "room-1", "reply-1"));
  });
});
