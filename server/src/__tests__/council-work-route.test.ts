import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  selectFastResponse: vi.fn(),
  credential: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
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
const issueId = "22222222-2222-4222-8222-222222222222";
const workPath = `/api/companies/${companyId}/council/rooms/${issueId}/work`;
const seat = (id: string, role = "none") => ({ id, name: id, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null });

function dbFor(seats: unknown[]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const rowsFor = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return { select: () => ({ from: (table: unknown) => ({ where: () => query(rowsFor(table)) }) }), transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;
}

async function app(db: never) {
  const { councilChatRoutes } = await import("../routes/council-chat.js");
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    req.actor = { type: "board", source: "session", userId: "alice", companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "owner" }] } as typeof req.actor;
    next();
  });
  server.use("/api", councilChatRoutes(db));
  server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).json({ error: error.message }));
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
});

describe("council work routes", () => {
  it("starts work and exposes step progress", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockResolvedValueOnce({ text: "1. Research | assignee: worker | expected: facts" }).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ text: "GRADE: PASS NOTE: ok" }).mockResolvedValueOnce({ text: "# Summary" });
    const server = await app(dbFor([seat("chair", "moderator"), seat("worker")])) ;

    expect((await request(server).post(workPath).send({ goal: "Research this" })).status).toBe(202);
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(2));
    const progress = await request(server).get(workPath);
    expect(progress.body).toMatchObject({ status: "running", steps: [{ title: "Research", assignee: "worker", status: "running" }] });
    pending.resolve({ text: "facts" });
    await vi.waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
  });

  it("posts the goal as the user comment before starting work when requested", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockResolvedValueOnce({ text: "1. Research | assignee: worker | expected: facts" }).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ text: "GRADE: PASS NOTE: ok" }).mockResolvedValueOnce({ text: "# Summary" });
    const server = await app(dbFor([seat("chair", "moderator"), seat("worker")]));

    expect((await request(server).post(workPath).send({ goal: "Research this", postGoal: true })).status).toBe(202);
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(2));
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.addComment).toHaveBeenCalledWith(issueId, "Research this", { userId: "alice" });

    pending.resolve({ text: "facts" });
    await vi.waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(2));
    expect(mocks.addComment.mock.calls[1]?.[1]).toContain("## Work summary");
  });

  it("does not post the goal when postGoal is omitted", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "1. Research | assignee: worker | expected: facts" }).mockResolvedValueOnce({ text: "facts" }).mockResolvedValueOnce({ text: "GRADE: PASS NOTE: ok" }).mockResolvedValueOnce({ text: "# Summary" });
    const server = await app(dbFor([seat("chair", "moderator"), seat("worker")]));

    await request(server).post(workPath).send({ goal: "Research this" });
    await vi.waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    expect(mocks.addComment).toHaveBeenCalledWith(issueId, expect.stringContaining("## Work summary"), { userId: "council-seat:chair" });
    expect(mocks.addComment.mock.calls[0]?.[1]).not.toBe("Research this");
  });

  it("rejects a second session while work is running", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const server = await app(dbFor([seat("chair", "moderator")]));

    expect((await request(server).post(workPath).send({ goal: "First" })).status).toBe(202);
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    const conflict = await request(server).post(workPath).send({ goal: "Second" });
    expect(conflict.status).toBe(409);
    await request(server).post(`${workPath}/stop`);
    pending.resolve({ text: "late plan" });
  });

  it("persists one chair-authored summary comment with collapsed step outputs", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "1. Research | assignee: worker | expected: facts" }).mockResolvedValueOnce({ text: "facts" }).mockResolvedValueOnce({ text: "GRADE: PASS NOTE: ok" }).mockResolvedValueOnce({ text: "# Summary" });
    const server = await app(dbFor([seat("chair", "moderator"), seat("worker")]));

    await request(server).post(workPath).send({ goal: "Research this" });
    await vi.waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(1));
    expect(mocks.addComment).toHaveBeenCalledWith(issueId, expect.stringContaining("## Work summary"), { userId: "council-seat:chair" });
    expect(mocks.addComment.mock.calls[0]?.[1]).toContain("<summary>Step outputs</summary>");
  });

  it("stops a session and reports cancelled work", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const server = await app(dbFor([seat("chair", "moderator")]));

    await request(server).post(workPath).send({ goal: "Research this" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    expect((await request(server).post(`${workPath}/stop`)).body).toEqual({ stopped: true });
    pending.resolve({ text: "late plan" });
    await vi.waitFor(async () => expect((await request(server).get(workPath)).body.status).toBe("cancelled"));
    expect(mocks.addComment).not.toHaveBeenCalled();
  });
});
