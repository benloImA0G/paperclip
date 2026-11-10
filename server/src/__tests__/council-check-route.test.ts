import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ checkSeats: vi.fn() }));
vi.mock("../services/council-chat.js", () => ({
  COUNCIL_ORIGIN_KIND: "council",
  roomMetadata: vi.fn(),
  councilChatService: () => ({ checkSeats: mocks.checkSeats }),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const path = `/api/companies/${companyId}/council/rooms/${issueId}/seats/check`;

async function app(allowed = true) {
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId: "alice", companyIds: allowed ? [companyId] : [], memberships: allowed ? [{ companyId, status: "active", membershipRole: "owner" }] : [] } as typeof req.actor;
    next();
  });
  server.use("/api", councilChatRoutes({} as never));
  server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).json({ error: error.message }));
  return server;
}

beforeEach(() => vi.clearAllMocks());
describe("council seat check route", () => {
  it("returns results and translates provider errors into plain words", async () => {
    mocks.checkSeats.mockResolvedValue({ results: [
      { seatId: "1", seatName: "Alpha", model: "model", ok: true, status: "ok", durationMs: 1300 },
      { seatId: "2", seatName: "Beta", model: "model", ok: false, status: "error", durationMs: 100, error: "401 unauthorized https://example.com Bearer secret" },
    ] });
    const response = await request(await app()).post(path).send({});
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      { seatId: "1", seatName: "Alpha", model: "model", ok: true, status: "ok", durationMs: 1300 },
      { seatId: "2", seatName: "Beta", model: "model", ok: false, status: "error", durationMs: 100, error: "The connection was refused (wrong or expired key). Check the connection's credentials." },
    ]);
    expect(mocks.checkSeats).toHaveBeenCalledWith({ companyId, issueId, userId: "alice", signal: expect.any(AbortSignal) });
  }, 60000);
  it("requires company access", async () => {
    const response = await request(await app(false)).post(path).send({});
    expect(response.status).toBe(403);
    expect(mocks.checkSeats).not.toHaveBeenCalled();
  });
});
