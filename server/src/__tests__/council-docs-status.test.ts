import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listAttachments: vi.fn(), getObject: vi.fn() }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listAttachments: mocks.listAttachments }) }));
vi.mock("../storage/index.js", () => ({ getStorageService: () => ({ getObject: mocks.getObject }) }));
const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const attachment = (id: string, filename: string) => ({ id, companyId, issueId, originalFilename: filename, objectKey: id, contentType: "application/octet-stream", byteSize: 10 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAttachments.mockResolvedValue([attachment("a", "notes.md"), attachment("b", "image.png"), attachment("c", "macro.docx")]);
  mocks.getObject.mockImplementation(async (_company: string, key: string) => ({ stream: Readable.from([Buffer.from(key === "c" ? "vbaProject.bin" : "Hello world")]) }));
});

it("reports extraction results without returning document text", async () => {
  const { loadCouncilDocuments } = await import("../services/council-chat.js");
  const result = await loadCouncilDocuments({} as never, companyId, issueId);
  expect(result.maxDocuments).toBe(5);
  expect(result.documents).toEqual([
    expect.objectContaining({ attachmentId: "a", readable: true, characters: 11 }),
    expect.objectContaining({ attachmentId: "b", readable: false, reason: "Not supported" }),
    expect.objectContaining({ attachmentId: "c", readable: false, reason: "Macro-enabled documents are not supported" }),
  ]);
}, 60_000);

it("counts only eligible files towards the five document limit", async () => {
  mocks.listAttachments.mockResolvedValue([attachment("unsupported", "image.png"), { ...attachment("large", "large.md"), byteSize: 524289 }, ...Array.from({ length: 6 }, (_, i) => attachment(String(i), `${i}.md`))]);
  const { loadCouncilDocuments } = await import("../services/council-chat.js");
  const result = await loadCouncilDocuments({} as never, companyId, issueId);
  expect(result.documents[1].reason).toBe("Too large");
  expect(result.documents[6].readable).toBe(true);
  expect(result.documents[7].reason).toBe("Not read: only the first 5 are used");
});

it("checks the room and returns only status over the board route", async () => {
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  let roomExists = true;
  const db = { select: () => ({ from: () => ({ where: async () => roomExists ? [{ id: issueId, companyId, originKind: "council" }] : [] }) }) } as never;
  const app = express();
  app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: "alice", companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "owner" }] } as typeof req.actor; next(); });
  app.use("/api", councilChatRoutes(db));
  app.use((error: { status?: number }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).end());
  const response = await request(app).get(`/api/companies/${companyId}/council/rooms/${issueId}/documents/status`);
  expect(response.status).toBe(200);
  expect(response.body.documents[0]).toMatchObject({ readable: true, characters: 11 });
  expect(JSON.stringify(response.body)).not.toContain("Hello world");
  roomExists = false;
  expect((await request(app).get(`/api/companies/${companyId}/council/rooms/${otherId}/documents/status`)).status).toBe(404);
  expect((await request(app).get(`/api/companies/${otherId}/council/rooms/${issueId}/documents/status`)).status).toBe(403);
});
