import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({ updateKind: vi.fn(), runRound: vi.fn() }));

vi.mock("../services/council-chat.js", () => ({
  COUNCIL_ORIGIN_KIND: "council",
  councilChatService: () => ({ updateKind: mocks.updateKind, runRound: mocks.runRound }),
}));
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: () => ({ actorType: "user", actorId: "alice" }),
}));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";

async function app() {
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId: "alice", companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "owner" }] } as typeof req.actor;
    next();
  });
  server.use("/api", councilChatRoutes({} as never));
  server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) =>
    res.status(error instanceof ZodError ? 400 : (error.status ?? 500)).json({ error: error.message }));
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateKind.mockResolvedValue({ kind: null });
  mocks.runRound.mockResolvedValue({ results: [] });
});

describe("council room kind routes", () => {
  it("rejects an invalid kind", async () => {
    const response = await request(await app()).put(`/api/companies/${companyId}/council/rooms/${issueId}/kind`).send({ kind: "other" });
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(mocks.updateKind).not.toHaveBeenCalled();
  }, 30_000);

  it("accepts null to clear the saved kind", async () => {
    const response = await request(await app()).put(`/api/companies/${companyId}/council/rooms/${issueId}/kind`).send({ kind: null });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(mocks.updateKind).toHaveBeenCalledWith(companyId, issueId, null);
  }, 30_000);

  it("auto-classifies a round message without replacing a saved kind", async () => {
    const response = await request(await app()).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds`).send({ message: "Please review this design and find risks" });
    expect(response.status).toBe(200);
    expect(mocks.updateKind).toHaveBeenCalledWith(companyId, issueId, "review", true);
    expect(mocks.runRound).toHaveBeenCalledWith(expect.objectContaining({ message: "Please review this design and find risks" }));
  }, 30_000);
});
