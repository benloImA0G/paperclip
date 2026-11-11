import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listAttachments: vi.fn(), getObject: vi.fn() }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listAttachments: mocks.listAttachments }) }));
vi.mock("../storage/index.js", () => ({ getStorageService: () => ({ getObject: mocks.getObject }) }));

const issueId = "cache-issue";
const attachment = (id: string, companyId = "cache-company", byteSize = 1) => ({
  id, companyId, issueId, byteSize, createdAt: new Date("2026-01-01"),
  originalFilename: "notes.md", objectKey: id, contentType: "text/plain",
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getObject.mockImplementation(async () => ({ stream: Readable.from([Buffer.from("x")]) }));
});

it("misses on size, timestamp, and company changes", async () => {
  const { loadCouncilDocuments } = await import("../services/council-chat.js");
  const docs = await import("../services/council-docs.js");
  const extract = vi.spyOn(docs, "extractDocTextAsync");
  for (const item of [attachment("identity"), attachment("identity"), attachment("identity", "cache-company", 2),
    { ...attachment("identity", "cache-company", 2), updatedAt: new Date("2026-02-01") }, attachment("identity", "other-company")]) {
    mocks.listAttachments.mockResolvedValue([item]);
    await loadCouncilDocuments({} as never, item.companyId, issueId);
  }
  expect(mocks.getObject).toHaveBeenCalledTimes(4);
  expect(extract).toHaveBeenCalledTimes(4);
  extract.mockRestore();
});

it("evicts oldest text when the total byte limit is exceeded", async () => {
  const { loadCouncilDocuments } = await import("../services/council-chat.js");
  const docs = await import("../services/council-docs.js");
  const extract = vi.spyOn(docs, "extractDocTextAsync").mockResolvedValue({ ok: true, text: "é".repeat(4 * 1024 * 1024), kind: "text" });
  for (const id of ["large-a", "large-b", "large-c", "large-b", "large-a"]) {
    mocks.listAttachments.mockResolvedValue([attachment(id)]);
    await loadCouncilDocuments({} as never, "cache-company", issueId);
  }
  expect(mocks.getObject).toHaveBeenCalledTimes(4);
  expect(extract).toHaveBeenCalledTimes(4);
  extract.mockRestore();
});
