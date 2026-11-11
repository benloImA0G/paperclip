// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbProvider } from "../context/BreadcrumbContext";
import { ThemeProvider } from "../context/ThemeContext";
import { DialogProvider } from "../context/DialogContext";
import { Council } from "./Council";

const api = vi.hoisted(() => ({
  comments: {} as Record<string, unknown[]>,
  createRoom: vi.fn(), updateKind: vi.fn(), runRound: vi.fn(), forkRoom: vi.fn(), listRooms: vi.fn(), listAttachments: vi.fn(), uploadAttachment: vi.fn(), pushToast: vi.fn(), listArtifacts: vi.fn(), getArtifact: vi.fn(),
}));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: api.pushToast }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }), useOptionalCompany: () => null }));
vi.mock("../api/council", () => ({ councilApi: {
  listRooms: api.listRooms,
  listArchivedRooms: vi.fn(async () => []),
  listSeats: vi.fn(async () => [
    { id: "seat-1", name: "Alice", kind: "vendor", connectionId: "conn-1", model: "model", role: "none", fallbacks: [], active: true },
    { id: "seat-2", name: "Bob", kind: "vendor", connectionId: "conn-2", model: "model", role: "none", fallbacks: [], active: true },
  ]),
  getBrief: vi.fn(async () => ({ brief: "" })), getWork: vi.fn(async () => ({ status: "idle", steps: [] })),
  getReliability: vi.fn(async () => null), listArtifacts: api.listArtifacts, getArtifact: api.getArtifact,
  getExportSetting: vi.fn(async () => ({ requireApproval: false })), listModels: vi.fn(async () => []),
  createRoom: api.createRoom, updateKind: api.updateKind, runRound: api.runRound, forkRoom: api.forkRoom,
} }));
vi.mock("../api/ai-connections", () => ({ aiConnectionsApi: { list: vi.fn(async () => ({ connections: [
  { id: "conn-1", grantId: "grant-1", name: "Cloud One", provider: "openai", routing: { kind: "cloud" } },
  { id: "conn-2", grantId: "grant-2", name: "Cloud Two", provider: "openai", routing: { kind: "cloud" } },
] })) } }));
vi.mock("../api/issues", () => ({ issuesApi: {
  listAttachments: api.listAttachments, uploadAttachment: api.uploadAttachment,
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
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><DialogProvider><Council /></DialogProvider></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
  await waitFor(() => expect(container.textContent).toContain("A useful answer"));
}
async function click(label: string) { await act(async () => { button(label).click(); }); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.comments = { "room-1": [question, reply], "room-2": [question, { ...reply, id: "reply-2", body: "Second room answer" }] };
  api.listRooms.mockReset().mockResolvedValue([{ id: "room-1", title: "First room" }, { id: "room-2", title: "Second room" }]);
  api.listAttachments.mockReset().mockResolvedValue([]);
  api.uploadAttachment.mockReset().mockResolvedValue({});
  api.pushToast.mockReset();
  api.listArtifacts.mockReset().mockResolvedValue([]);
  api.getArtifact.mockReset();
  api.createRoom.mockReset().mockResolvedValue({ id: "new-room" });
  api.updateKind.mockReset().mockResolvedValue({});
  api.runRound.mockReset().mockResolvedValue({ results: [] });
  api.forkRoom.mockReset().mockResolvedValue({ room: { id: "room-2" } });
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });

describe("Council page", () => {
  it.each([["", "Quick check", "quick-fact"], ["QA room", "QA room", "decision"]])("creates the selected mode with the entered or default name", async (title, expected, kind) => {
    await renderPage();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="New war room"]')!.click(); });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Room title"]')!;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Quick check");
    if (title) {
      const decision = [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((el) => el.textContent?.startsWith("Decision"))!;
      await act(async () => { decision.click(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, title); input.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    expect(container.textContent).toContain(`Selected: ${title ? "Decision" : "Quick check"}`);
    await click("Create");
    await waitFor(() => expect(api.updateKind).toHaveBeenCalledWith("company-1", "new-room", kind));
    expect(api.createRoom).toHaveBeenCalledWith("company-1", expected);
  });
  it("shows separate room kind and a mobile message actions disclosure", async () => {
    api.listRooms.mockResolvedValue([{ id: "room-1", title: "Named room", kind: "decision" }]);
    await renderPage();
    const room = [...container.querySelectorAll<HTMLButtonElement>(".council-rooms button")].find((el) => el.textContent?.includes("Named room"))!;
    expect(room.querySelector("span.ml-2")?.textContent).toBe("Decision");
    const menu = container.querySelector<HTMLButtonElement>('button[aria-label="Message actions"]')!;
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    await act(async () => menu.click());
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll('select[aria-label="Download reply as"]')).toHaveLength(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);
    await act(async () => menu.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
  it("shows supported document count and opens the documents heading", async () => {
    api.listAttachments.mockResolvedValue([{ id: "a", originalFilename: "notes.md", byteSize: 42 }, { id: "b", originalFilename: "image.png", byteSize: 42 }, { id: "c", originalFilename: "large.md", byteSize: 600000 }]);
    await renderPage();
    expect(container.textContent).not.toContain("Tip: drop a file onto this room");
    await waitFor(() => expect(container.querySelector('button[aria-label="Documents, 1 attached"]')).toBeTruthy());
    const chip = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Documents, 1 attached"]')].at(-1)!;
    expect(chip.textContent).toContain("Documents (1)");
    await act(async () => { chip.click(); });
    expect(container.querySelector('[role="dialog"][aria-label="Room settings"]')).toBeTruthy();
    expect(document.activeElement?.id).toBe("council-documents-heading");
  });
  it("shows a zero-count shortcut and the drop tip only for an empty room without documents", async () => {
    api.comments["room-1"] = [];
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><DialogProvider><Council /></DialogProvider></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
    await waitFor(() => expect(container.textContent).toContain("Tip: drop a file onto this room to give the seats something to read."));
    const chip = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Documents, 0 attached"]')].at(-1)!;
    expect(chip).toBeTruthy();
    expect(chip.querySelector("[class*='max-sm:hidden']")?.textContent).toBe("Documents");
    await act(async () => { client.setQueryData(["issues", "attachments", "room-1"], [{ id: "a", originalFilename: "notes.md", byteSize: 42 }]); });
    await waitFor(() => expect(container.textContent).not.toContain("Tip: drop a file onto this room"));
    await act(async () => { client.setQueryData(["issues", "attachments", "room-1"], []); client.setQueryData(["council", "company-1", "room-1", "comments"], [question]); });
    await waitFor(() => expect(container.textContent).not.toContain("Tip: drop a file onto this room"));
  });
  it("offers document review in an open room with a document", async () => {
    api.listAttachments.mockResolvedValue([{ id: "a", originalFilename: "notes.md", byteSize: 42 }]);
    await renderPage();
    await waitFor(() => expect(container.textContent).toContain("Review a document"));
    await click("Review a document");
    expect((container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement).value).toContain("Review the attached document");
  });
  it("passes document metadata to seat and summary reply footers", async () => {
    api.comments["room-1"] = [question, { ...reply, metadata: { councilReliability: { documents: ["notes.md"] } } }, { ...reply, id: "summary", authorUserId: "council-seat:summary", body: "Summary", metadata: { councilReliability: { documents: ["brief.md"] } } }];
    await renderPage();
    expect(container.textContent).toContain("Read: notes.md");
    expect(container.textContent).toContain("Read: brief.md");
  });
  it("closes message options on Escape, outside click and composer focus", async () => {
    await renderPage();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Message options"]')!;
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the council"]')!;
    await act(async () => { trigger.click(); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    await act(async () => { trigger.click(); });
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { trigger.click(); });
    await act(async () => { input.focus(); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("clears the submitted draft immediately and restores it on failure", async () => {
    let reject!: (error: Error) => void;
    api.runRound.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    await renderPage();
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the council"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "My question"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Send");
    await waitFor(() => expect(input.value).toBe(""));
    await act(async () => reject(new Error("Failed")));
    await waitFor(() => expect(input.value).toBe("My question"));
  });
  it.each([1, 2])("shows comparison only when artifact has multiple revisions (%s)", async (count) => {
    const artifact = { key: "draft", title: "Draft", latestRevisionNumber: count, body: "current", revisions: Array.from({ length: count }, (_, i) => ({ revisionNumber: i + 1, createdAt: "2026-01-01" })) };
    api.listArtifacts.mockResolvedValue([artifact]);
    api.getArtifact.mockResolvedValue(artifact);
    await renderPage();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Room settings"]')!.click(); });
    await click("Artifacts");
    await waitFor(() => expect(container.textContent).toContain(`Draft v${count}`));
    await click(`Draft v${count}`);
    await waitFor(() => expect(container.querySelector('select[aria-label="Artifact revision"]')).toBeTruthy());
    expect(container.textContent?.includes("Compare with previous version")).toBe(count >= 2);
    if (count === 2) {
      await act(async () => { [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Compare with previous version"))!.querySelector("input")!.click(); });
      await waitFor(() => expect(api.getArtifact).toHaveBeenCalledWith("company-1", "room-1", "draft", 1));
      await waitFor(() => expect(container.textContent).toContain("No changes"));
    }
  });
  it.each(["", "My existing draft"])("fills the review prompt only for an empty composer: %s", async (draft) => {
    await renderPage();
    const input = container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement;
    if (draft) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, draft);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="New war room"]')!.click(); });
    const preset = [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((el) => el.textContent?.includes("Review a document"))!;
    await act(async () => { preset.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Cancel new war room"]')!.click(); });
    expect((container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement).value).toBe(draft || "Review the attached document. List the biggest gaps, risks and contradictions, cite the source marker (like [d1#2]) for each, and suggest one concrete fix per point.");
    expect(api.runRound).not.toHaveBeenCalled();
  });
  it.each(["", "My existing draft"])("adds a document prompt to the composer: %s", async (draft) => {
    api.listAttachments.mockResolvedValue([{ id: "a", originalFilename: "notes.md", byteSize: 42 }]);
    await renderPage();
    const input = container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement;
    if (draft) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, draft);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Room settings"]')!.click(); });
    await waitFor(() => expect(container.textContent).toContain("Ask about this"));
    await click("Ask about this");
    expect(input.value).toBe(`${draft ? `${draft}\n` : ""}Summarize "notes.md" and list the three most important points, citing source markers like [d1#2].`);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('section[aria-label="Documents"]')).toBeNull();
    expect(api.runRound).not.toHaveBeenCalled();
  });
  it("toggles the mobile room options disclosure", async () => {
    await renderPage();
    const disclosure = button("Options");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });
  it("shows and closes composer options when sending", async () => {
    await renderPage();
    const disclosure = container.querySelector<HTMLButtonElement>('button[aria-label="Message options"]')!;
    expect(disclosure.textContent?.trim()).toBe("Options");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`#${disclosure.getAttribute("aria-controls")}`)).toBeTruthy();
    const input = container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Hello council");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Send");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#council-options-popover")).toBeNull();
    await waitFor(() => expect(api.runRound).toHaveBeenCalled());
  });
  it("uploads dropped documents and invalidates room attachments", async () => {
    await renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const file = new File(["notes"], "notes.md", { type: "text/markdown" });
    const shell = container.querySelector(".council-thread-shell")!;
    await act(async () => { const event = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { files: [file] } }); shell.dispatchEvent(event); });
    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledWith("company-1", "room-1", file));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["issues", "attachments", "room-1"] }));
  });
  it("reports unsupported dropped files", async () => {
    await renderPage();
    const shell = container.querySelector(".council-thread-shell")!;
    await act(async () => { const event = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["x"], "notes.exe")] } }); shell.dispatchEvent(event); });
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(api.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Skipped notes.exe: unsupported type" }));
  });
  it("counts existing supported documents before uploading", async () => {
    api.listAttachments.mockResolvedValue([...Array.from({ length: 4 }, (_, i) => ({ id: String(i), originalFilename: `${i}.md`, byteSize: 10 })), { id: "ignored", originalFilename: "image.png", byteSize: 10 }]);
    await renderPage(); const shell = container.querySelector(".council-thread-shell")!;
    const files = [new File(["a"], "a.md"), new File(["b"], "b.md")];
    await act(async () => { const event = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { files } }); shell.dispatchEvent(event); });
    await waitFor(() => expect(api.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Skipped b.md: room already has 5 documents" })));
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(api.uploadAttachment).toHaveBeenCalledWith("company-1", "room-1", files[0]);
  });
  it("prevents image drops and reports ignored images in mixed drops", async () => {
    await renderPage(); const shell = container.querySelector(".council-thread-shell")!;
    for (const files of [[new File(["x"], "image.png", { type: "image/png" })], [new File(["x"], "mixed.png", { type: "image/png" }), new File(["x"], "notes.md")]]) {
      const event = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: { files } });
      await act(async () => { shell.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(api.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: `Skipped ${files[0].name}: images must be added in the composer` })));
    }
  });
  it("ignores text drags", async () => {
    await renderPage();
    const shell = container.querySelector(".council-thread-shell")!;
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { items: [{ kind: "string", type: "text/plain" }], types: ["text/plain"] } });
    await act(async () => { shell.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(container.textContent).not.toContain("Drop to add as room document");
  });
  it("shows documents for the open room in settings", async () => {
    await renderPage();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Room settings"]')!.click(); });
    expect(container.querySelector('section[aria-label="Documents"]')).toBeTruthy();
    await waitFor(() => expect(api.listAttachments).toHaveBeenCalledWith("room-1"));
  });
  it("does not show documents when no room is open", async () => {
    api.listRooms.mockResolvedValue([]);
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><DialogProvider><Council /></DialogProvider></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
    await waitFor(() => expect(container.textContent).toContain("Create"));
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Room settings"]')!.click(); });
    expect(container.querySelector('section[aria-label="Documents"]')).toBeNull();
    expect(api.listAttachments).not.toHaveBeenCalled();
  });
  it("discloses mobile seats while retaining the desktop seat pills", async () => {
    await renderPage();
    const disclosure = button("2 seats");
    const pills = container.querySelector<HTMLElement>("#council-seat-pills")!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(pills.className).toContain("max-sm:hidden");
    expect(pills.textContent).toContain("Alice");
    expect(pills.textContent).toContain("Bob");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(pills.className).not.toContain("max-sm:hidden");
    await act(async () => { disclosure.click(); });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });
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
  it("remembers answer styles independently when switching rooms and remounting", async () => {
    await renderPage();
    await click("One after another");
    await click("Second room");
    await waitFor(() => expect(container.textContent).toContain("Second room answer"));
    expect(button("Work together").getAttribute("aria-pressed")).toBe("true");
    await click("Challenge each other");
    await click("First room");
    await waitFor(() => expect(button("One after another").getAttribute("aria-pressed")).toBe("true"));
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(button("One after another").getAttribute("aria-pressed")).toBe("true");
    await click("Second room");
    await waitFor(() => expect(button("Challenge each other").getAttribute("aria-pressed")).toBe("true"));
  });
  it("shows first-use steps only while the room has no comments", async () => {
    api.comments["room-1"] = [];
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ThemeProvider><BreadcrumbProvider><DialogProvider><Council /></DialogProvider></BreadcrumbProvider></ThemeProvider></MemoryRouter></QueryClientProvider>));
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
  it("uses the model recorded with a reply", async () => {
    api.comments["room-1"] = [question, { ...reply, metadata: { councilReliability: { model: "original-model", fallbackUsed: true } } }];
    await renderPage();
    expect(container.textContent).toContain("(original-model)");
    expect(container.textContent).toContain("answered by a backup model");
  });
  it("sends a targeted question as one answer without ranking or jury", async () => {
    await renderPage();
    const input = container.querySelector('textarea[aria-label="Message the council"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "@Alice What do you think?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("About 1 model call");
    await click("Send");
    await waitFor(() => expect(api.runRound).toHaveBeenCalledTimes(1));
    expect(api.runRound.mock.calls[0][2]).toMatchObject({ mode: "ask", ranking: false, jury: false });
  });
  it("forks from the reply", async () => {
    await renderPage(); await click("Fork from here");
    await waitFor(() => expect(api.forkRoom).toHaveBeenCalledWith("company-1", "room-1", "reply-1"));
  });
});
