import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, costEvents, councilSeats, createDb, issueComments, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const companyId = randomUUID();
const otherCompanyId = randomUUID();
const roomId = randomUUID();
const otherRoomId = randomUUID();
const modelSeatId = randomUUID();
const moderatorSeatId = randomUUID();
const agentSeatId = randomUUID();
const agentId = randomUUID();
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

describe("Council estimates", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-estimate-");
    db = createDb(database.connectionString);
    await db.insert(companies).values([
      { id: companyId, name: "Council", issuePrefix: "C", requireBoardApprovalForNewAgents: false },
      { id: otherCompanyId, name: "Other", issuePrefix: "O", requireBoardApprovalForNewAgents: false },
    ]);
    await db.insert(issues).values([
      { id: roomId, companyId, title: "Room", originKind: "council" },
      { id: otherRoomId, companyId: otherCompanyId, title: "Other room", originKind: "council" },
    ]);
    await db.insert(agents).values({ id: agentId, companyId, name: "Estimate agent", adapterType: "hermes_gateway" });
    await db.insert(councilSeats).values([
      { id: modelSeatId, companyId, issueId: roomId, name: "Research", seatKind: "model", connectionId: randomUUID(), grantId: randomUUID(), model: "gpt-test", position: 0 },
      { id: moderatorSeatId, companyId, issueId: roomId, name: "Moderator", seatKind: "model", connectionId: randomUUID(), grantId: randomUUID(), model: "gpt-moderator", fallbacks: { fallbacks: [], role: "moderator" }, position: 1 },
      { id: agentSeatId, companyId, issueId: roomId, name: "Unpriced agent", seatKind: "agent", agentId, position: 2 },
    ]);
  });

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(costEvents);
  });

  afterAll(async () => {
    await db.delete(councilSeats);
    await db.delete(agents);
    await db.delete(issues);
    await db.delete(companies);
    await database.cleanup();
  });

  async function app(companyIds = [companyId]) {
    const { councilChatRoutes } = await import("../routes/council-chat.js");
    const server = express();
    server.use((req, _res, next) => {
      req.actor = {
        type: "board", source: "session", userId: "alice", companyIds,
        memberships: companyIds.map((id) => ({ companyId: id, status: "active", membershipRole: "owner" })),
      } as typeof req.actor;
      next();
    });
    server.use("/api", councilChatRoutes(db));
    server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => {
      res.status(error.status ?? 500).json({ error: error.message ?? "Internal error" });
    });
    return server;
  }

  it("estimates calls for each mode and separates priced from unpriced seats", async () => {
    await db.insert(costEvents).values([
      { companyId, issueId: roomId, usageKind: "fast_response", billingCode: `council:${roomId}`, provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-test", inputTokens: 1, outputTokens: 1, costCents: 100, occurredAt: new Date("2026-01-01") },
      { companyId, issueId: roomId, usageKind: "fast_response", billingCode: `council:${roomId}`, provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-test", inputTokens: 1, outputTokens: 1, costCents: 200, occurredAt: new Date("2026-01-02") },
    ]);
    await db.insert(issueComments).values({
      companyId, issueId: roomId, authorUserId: `council-seat:${modelSeatId}`, body: "Answer",
      metadata: { councilReliability: { durationMs: 10_000 } },
    });
    const server = await app();
    const ask = await request(server).get(`/api/companies/${companyId}/council/rooms/${roomId}/estimate`);
    expect(ask.status).toBe(200);
    expect(ask.body).toMatchObject({ mode: "ask", label: "estimate", calls: 3, estimatedCostCents: { low: 75, high: 300 }, unpricedSeats: 2, estimatedSeconds: { low: 15, high: 90 } });
    expect(ask.body.seats).toEqual(expect.arrayContaining([
      { seatId: modelSeatId, label: "Research", kind: "model", calls: 1, estimatedCostCents: 150, basis: "history" },
      { seatId: agentSeatId, label: "Unpriced agent", kind: "agent", calls: 1, estimatedCostCents: null, basis: "none" },
    ]));

    const discuss = await request(server).get(`/api/companies/${companyId}/council/rooms/${roomId}/estimate?mode=discuss`);
    expect(discuss.status).toBe(200);
    expect(discuss.body.calls).toBe(9);
    expect(discuss.body.seats.reduce((total: number, seat: { calls: number }) => total + seat.calls, 0)).toBe(9);

    const summarize = await request(server).get(`/api/companies/${companyId}/council/rooms/${roomId}/estimate?mode=summarize`);
    expect(summarize.status).toBe(200);
    expect(summarize.body).toMatchObject({ mode: "summarize", calls: 1, estimatedCostCents: { low: 75, high: 300 }, estimatedSeconds: { low: 10, high: 20 } });
    expect(summarize.body.seats).toEqual(expect.arrayContaining([
      expect.objectContaining({ seatId: modelSeatId, calls: 1 }),
      expect.objectContaining({ seatId: moderatorSeatId, calls: 0 }),
    ]));
  });

  it("rejects invalid modes and does not reveal rooms across companies", async () => {
    const server = await app();
    expect((await request(server).get(`/api/companies/${companyId}/council/rooms/${roomId}/estimate?mode=invalid`)).status).toBe(400);
    expect((await request(server).get(`/api/companies/${companyId}/council/rooms/${otherRoomId}/estimate`)).status).toBe(404);
    expect((await request(await app([companyId])).get(`/api/companies/${otherCompanyId}/council/rooms/${otherRoomId}/estimate`)).status).toBe(403);
  });
});
