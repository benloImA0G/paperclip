import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { errorHandler } from "../middleware/error-handler.js";

const mocks = vi.hoisted(() => ({
  markdownToDocx: vi.fn(),
  markdownToPptx: vi.fn(),
  PandocUnavailableError: class PandocUnavailableError extends Error {},
  getExportSetting: vi.fn(),
}));

vi.mock("../services/council-export.js", () => mocks);
vi.mock("../services/council-chat.js", () => ({
  COUNCIL_ORIGIN_KIND: "council",
  councilChatService: () => ({ getExportSetting: mocks.getExportSetting }),
}));
vi.mock("../services/index.js", () => ({
  issueService: () => ({}),
}));

const companyId = "11111111-1111-4111-8111-111111111111";

async function createApp() {
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "session",
      userId: "alice",
      companyIds: [companyId],
      memberships: [{ companyId, status: "active", membershipRole: "owner" }],
    } as typeof req.actor;
    next();
  });
  app.use("/api", councilChatRoutes({} as Db));
  app.use(errorHandler);
  return app;
}

const path = `/api/companies/${companyId}/council/export`;
const validRequest = { roomId: "22222222-2222-4222-8222-222222222222", format: "docx", title: "Quarterly Council", markdown: "# Council\n\nSummary" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getExportSetting.mockResolvedValue({ requireApproval: false });
  mocks.markdownToDocx.mockResolvedValue(Buffer.from("docx bytes"));
  mocks.markdownToPptx.mockResolvedValue(Buffer.from("pptx bytes"));
});

describe("POST /companies/:companyId/council/export", () => {
  it.each([
    ["invalid format", { ...validRequest, format: "pdf" }],
    ["empty markdown", { ...validRequest, markdown: "" }],
    ["oversized markdown", { ...validRequest, markdown: "x".repeat(100_001) }],
    ["unknown extra field", { ...validRequest, extra: true }],
  ])("rejects %s with 400", async (_label, body) => {
    const response = await request(await createApp()).post(path).send(body);
    expect(response.status).toBe(400);
    expect(mocks.markdownToDocx).not.toHaveBeenCalled();
    expect(mocks.markdownToPptx).not.toHaveBeenCalled();
  });

  it("returns 503 when Pandoc is unavailable", async () => {
    mocks.markdownToDocx.mockRejectedValueOnce(new mocks.PandocUnavailableError("Pandoc is unavailable"));

    const response = await request(await createApp()).post(path).send(validRequest);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Pandoc is unavailable" });
  });

  it("returns the export with an attachment filename and content type", async () => {
    const response = await request(await createApp()).post(path).buffer(true).send(validRequest);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(
      /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Quarterly Council.docx"',
    );
    expect(mocks.markdownToDocx).toHaveBeenCalledWith(validRequest.title, validRequest.markdown);
  });

  it("returns 409 when the room requires approval and the request is not approved", async () => {
    mocks.getExportSetting.mockResolvedValueOnce({ requireApproval: true });
    const response = await request(await createApp()).post(path).send(validRequest);
    expect(response.status).toBe(409);
    expect(mocks.markdownToDocx).not.toHaveBeenCalled();
  });

  it("exports when the room requires approval and the request is approved", async () => {
    mocks.getExportSetting.mockResolvedValueOnce({ requireApproval: true });
    const response = await request(await createApp()).post(path).buffer(true).send({ ...validRequest, approved: true });
    expect(response.status).toBe(200);
    expect(mocks.markdownToDocx).toHaveBeenCalledWith(validRequest.title, validRequest.markdown);
  });
});
