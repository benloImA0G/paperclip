import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  selectFastResponse: vi.fn(),
  credential: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({
  aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }),
}));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: async () => [], addComment: mocks.addComment }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({
  withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({
    insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }, []),
}));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "33333333-3333-4333-8333-333333333333";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";

const seat = (id: string, role = "none") => ({ id, name: id, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null });

function dbFor(seats: unknown[], roomCompanyId = companyId) {
  const room = { id: issueId, companyId: roomCompanyId, originKind: "council", description: "Council room" };
  const rowsFor = (table: unknown) => roomCompanyId !== companyId
    ? []
    : table === issues
    ? [room]
    : table === councilSeats
    ? seats
    : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
    orderBy: async () => rows,
    limit: async () => rows,
    for: async () => rows,
  });
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => query(rowsFor(table)) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
});

describe("Council round stop", () => {
  async function app(db: never, allowedCompanyId = companyId) {
    const { councilChatRoutes } = await import("../routes/council-chat.js");
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      req.actor = { type: "board", source: "session", userId, companyIds: [allowedCompanyId], memberships: [{ companyId: allowedCompanyId, status: "active", membershipRole: "owner" }] } as typeof req.actor;
      next();
    });
    server.use("/api", councilChatRoutes(db));
    server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error instanceof ZodError ? 400 : (error.status ?? 500)).json({ error: error.message }));
    return server;
  }

  it("POST rounds/stop returns stopped false for an idle room", async () => {
    const response = await request(await app(dbFor([]))).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds/stop`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stopped: false });
  });

  it("POST rounds/stop preserves company isolation", async () => {
    const response = await request(await app(dbFor([], otherCompanyId), otherCompanyId)).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds/stop`);
    expect(response.status).toBe(403);
  });

  it("stops a pending seat call and does not run the orchestrator", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(dbFor([seat("seat"), seat("moderator", "moderator")]));
    const round = service.runRound({ companyId, issueId, userId, message: "Question" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    expect(await service.stopRound(companyId, issueId)).toEqual({ stopped: true });
    pending.resolve({ text: "late reply" });
    const result = await round;
    expect(result.results).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.addComment).not.toHaveBeenCalledWith(issueId, "late reply", expect.anything());
  });

  it("does not persist a seat reply after stop", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(dbFor([seat("seat")]));
    const round = service.runRound({ companyId, issueId, userId, message: "Question" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await service.stopRound(companyId, issueId);
    pending.resolve({ text: "late reply" });
    await round;
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.addComment).not.toHaveBeenCalledWith(issueId, "late reply", expect.anything());
  });

  it("returns stopped false when the room is idle", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    expect(await councilChatService(dbFor([])).stopRound(companyId, issueId)).toEqual({ stopped: false });
  });

  it("enforces company isolation", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    await expect(councilChatService(dbFor([], otherCompanyId)).stopRound(companyId, issueId)).rejects.toMatchObject({ status: 404 });
  });

  it("does not abort a normally completing round", async () => {
    mocks.generateText.mockResolvedValue({ text: "reply" });
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(dbFor([seat("seat")]));
    const result = await service.runRound({ companyId, issueId, userId, message: "Question" });
    expect(result.results).toEqual([expect.objectContaining({ status: "ok", text: "reply" })]);
    expect(await service.stopRound(companyId, issueId)).toEqual({ stopped: false });
  });

  it("does not abort a normally completing rounds request", async () => {
    mocks.generateText.mockResolvedValue({ text: "reply" });
    const response = await request(await app(dbFor([seat("seat")]))).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds`).send({ message: "Question" });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([expect.objectContaining({ status: "ok", text: "reply" })]);
  });

  it("rejects an invalid speaking order before starting a round", async () => {
    const response = await request(await app(dbFor([seat("seat")]))).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds`).send({ message: "Question", order: "clockwise" });
    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects an invalid discussion style before starting a round", async () => {
    const response = await request(await app(dbFor([seat("seat")]))).post(`/api/companies/${companyId}/council/rooms/${issueId}/rounds`).send({ message: "Question", style: "debate" });
    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
