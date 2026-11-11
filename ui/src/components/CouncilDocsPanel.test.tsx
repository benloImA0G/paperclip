// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CouncilDocsPanel } from "./CouncilDocsPanel";

const api = vi.hoisted(() => ({ listAttachments: vi.fn(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn() }));
vi.mock("../api/issues", () => ({ issuesApi: api }));
const status = vi.hoisted(() => vi.fn());
vi.mock("../api/council", () => ({ councilApi: { documentStatus: status } }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><CouncilDocsPanel companyId="company" issueId="room" /></QueryClientProvider>));
  await flush();
}
async function selectFile(file: File) {
  const input = container.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
}
beforeEach(() => {
  vi.resetAllMocks();
  status.mockRejectedValue(new Error("unavailable"));
  api.listAttachments.mockResolvedValue([]);
  api.uploadAttachment.mockResolvedValue({});
  api.deleteAttachment.mockResolvedValue({ ok: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });

it("shows an empty state", async () => {
  await render();
  expect(api.listAttachments).toHaveBeenCalledWith("room");
  expect(container.textContent).toContain("No documents yet.");
});
it("lists attachments and removes one", async () => {
  api.listAttachments.mockResolvedValue([{ id: "a", originalFilename: "notes.md", byteSize: 42 }]);
  await render();
  expect(container.textContent).toContain("notes.md");
  expect(container.textContent).toContain("42 bytes");
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Remove notes.md"]')!;
  await act(async () => button.click());
  await flush();
  expect(api.deleteAttachment).toHaveBeenCalledWith("a");
});
it("uploads an allowed document", async () => {
  await render();
  const file = new File(["hello"], "notes.md", { type: "text/markdown" });
  await selectFile(file);
  expect(api.uploadAttachment).toHaveBeenCalledWith("company", "room", file);
});
it("rejects unsupported, macro-enabled, and oversized files with the applicable limit", async () => {
  await render();
  await selectFile(new File(["x"], "image.png"));
  expect(container.textContent).toContain("Choose a text, Markdown, CSV, JSON, Word, PowerPoint, Excel or EPUB document.");
  await selectFile(new File(["x"], "macro.docm"));
  expect(container.textContent).toContain("Macro-enabled files are not supported");
  await selectFile(new File([new Uint8Array(512 * 1024 + 1)], "large.txt"));
  expect(container.textContent).toContain("Text documents must be 512 KB or smaller.");
  await selectFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.docx"));
  expect(container.textContent).toContain("Documents must be 5 MB or smaller.");
  expect(api.uploadAttachment).not.toHaveBeenCalled();
});

it("accepts Office and EPUB document extensions and advertises the expanded list", async () => {
  await render();
  expect(container.textContent).toContain("Seats read these as untrusted reference text. Text, Markdown, CSV, JSON, Word, PowerPoint, Excel and EPUB files; up to 5 documents.");
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe(".txt,.md,.markdown,.csv,.json,.docx,.odt,.rtf,.html,.htm,.pptx,.xlsx,.epub");
  for (const filename of ["reference.odt", "slides.pptx", "sheet.xlsx", "book.epub"]) {
    const file = new File(["document"], filename);
    await selectFile(file);
    expect(api.uploadAttachment).toHaveBeenLastCalledWith("company", "room", file);
  }
});

it("limits supported documents and marks those beyond the fifth as not read", async () => {
  api.listAttachments.mockResolvedValue([
    { id: "unsupported", originalFilename: "image.png", byteSize: 42 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: String(i), originalFilename: `doc${i}.md`, byteSize: 42 })),
  ]);
  await render();
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  expect(container.textContent).toContain("Seats read up to 5 documents; remove one to add another.");
  const rows = [...container.querySelectorAll("li")];
  expect(rows.filter((row) => row.textContent?.includes("Not read")).map((row) => row.textContent)).toEqual([expect.stringContaining("doc5.md")]);
});

it("allows adding when fewer than five documents are supported", async () => {
  api.listAttachments.mockResolvedValue([
    ...Array.from({ length: 4 }, (_, i) => ({ id: String(i), originalFilename: `doc${i}.md`, byteSize: 42 })),
    { id: "large", originalFilename: "large.txt", byteSize: 512 * 1024 + 1 },
  ]);
  await render();
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
  expect(container.textContent).not.toContain("Not read");
});

it("shows readability and extraction reasons, and refreshes after attachments change", async () => {
  api.listAttachments.mockResolvedValue([{ id: "a", originalFilename: "notes.md", byteSize: 42 }, { id: "b", originalFilename: "macro.docx", byteSize: 10 }]);
  status.mockResolvedValue({ documents: [{ attachmentId: "a", readable: true, characters: 12340 }, { attachmentId: "b", readable: false, reason: "Macro-enabled documents are not supported" }], maxDocuments: 5 });
  await render();
  expect(container.textContent).toContain("Seats can read this (12,340 characters)");
  expect(container.textContent).toContain("Macro-enabled documents are not supported");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove notes.md"]')!.click());
  await flush();
  expect(status.mock.calls.length).toBeGreaterThan(1);
});
