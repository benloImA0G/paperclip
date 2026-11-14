import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, createDb, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const exportMocks = vi.hoisted(() => ({
  markdownToDocx: vi.fn().mockResolvedValue(Buffer.from("x")),
  markdownToPptx: vi.fn().mockResolvedValue(Buffer.from("pptx")),
  PandocUnavailableError: class PandocUnavailableError extends Error {},
}));

vi.mock("../services/council-export.js", () => exportMocks);

const companyId = randomUUID();
const otherCompanyId = randomUUID();
const roomId = randomUUID();
const otherRoomId = randomUUID();
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

describe("council route and service isolation", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-isolation-");
    db = createDb(database.connectionString);
    await db.insert(companies).values([
      { id: companyId, name: "Council One", issuePrefix: "C1", requireBoardApprovalForNewAgents: false },
      { id: otherCompanyId, name: "Council Two", issuePrefix: "C2", requireBoardApprovalForNewAgents: false },
    ]);
    await db.insert(issues).values([
      { id: roomId, companyId, title: "Room", originKind: "council", description: "Council room" },
      { id: otherRoomId, companyId: otherCompanyId, title: "Other room", originKind: "council", description: "Council room" },
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    exportMocks.markdownToDocx.mockResolvedValue(readFileSync(new URL("../services/council-reference.docx", import.meta.url)));
    exportMocks.markdownToPptx.mockResolvedValue(readFileSync(new URL("../services/council-reference.pptx", import.meta.url)));
  });

  afterAll(async () => {
    await db.delete(issues);
    await db.delete(companies);
    await database.cleanup();
  });

  async function app() {
    const { councilChatRoutes } = await import("../routes/council-chat.js");
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = {
        type: "board",
        source: "session",
        userId: "alice",
        companyIds: [companyId],
        memberships: [{ companyId, status: "active", membershipRole: "owner" }],
      } as typeof req.actor;
      next();
    });
    server.use("/api", councilChatRoutes(db));
    server.use((error: { status?: number; message?: string }, _req, res, _next) => {
      res.status(error instanceof ZodError ? 400 : (error.status ?? 500)).json({ error: error.message ?? "Internal error" });
    });
    return server;
  }

  it("rejects nonexistent and cross-company rooms for artifacts", async () => {
    const server = await app();
    for (const id of [randomUUID(), otherRoomId]) {
      const response = await request(server).get(`/api/companies/${companyId}/council/rooms/${id}/artifacts`);
      expect(response.status).toBe(404);
    }
    const forbidden = await request(server).get(`/api/companies/${otherCompanyId}/council/rooms/${otherRoomId}/artifacts`);
    expect(forbidden.status).toBe(403);
  });

  it.each(["council-output-Plan", "council-output-a:b", "council-output-../private"]) (
    "rejects unsafe artifact key %s",
    async (key) => {
      const response = await request(await app())
        .post(`/api/companies/${companyId}/council/rooms/${roomId}/artifacts`)
        .send({ key, title: "Artifact", markdown: "# Content" });
      expect(response.status).toBe(400);
    },
  );

  it.each(["", " ", "x".repeat(100_001)])("rejects invalid artifact markdown", async (markdown) => {
    const response = await request(await app())
      .post(`/api/companies/${companyId}/council/rooms/${roomId}/artifacts`)
      .send({ key: "council-output-plan", title: "Artifact", markdown });
    expect(response.status).toBe(400);
  });

  it("rejects export room IDs outside the company or absent", async () => {
    const body = { roomId: otherRoomId, format: "docx", title: "Export", markdown: "# Content" };
    expect((await request(await app()).post(`/api/companies/${companyId}/council/export`).send(body)).status).toBe(404);
    expect((await request(await app()).post(`/api/companies/${companyId}/council/export`).send({ ...body, roomId: randomUUID() })).status).toBe(404);
  });

  it("requires approval for export and exports when approved", async () => {
    await db.update(issues).set({ description: JSON.stringify({ version: 1, brief: "", requireApproval: true }) }).where(eq(issues.id, roomId));
    const body = { roomId, format: "docx", title: "Export", markdown: "# Content" };
    expect((await request(await app()).post(`/api/companies/${companyId}/council/export`).send(body)).status).toBe(409);
    expect((await request(await app()).post(`/api/companies/${companyId}/council/export`).send({ ...body, approved: true })).status).toBe(200);
  });
});
