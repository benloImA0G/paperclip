import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, councilSeats, councilWorkSessions, createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), addComment: vi.fn(), selectFastResponse: vi.fn(), credential: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: async () => [], addComment: mocks.addComment }) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _company: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({
  insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
}, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const postgres = await getEmbeddedPostgresTestSupport();
const describePostgres = postgres.supported ? describe : describe.skip;
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

describePostgres("durable Council work claims", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-work-claim-");
    db = createDb(database.connectionString);
  }, 20_000);

  afterAll(async () => { await database?.cleanup(); });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
    mocks.credential.mockResolvedValue("credential");
    mocks.addComment.mockResolvedValue({ id: randomUUID() });
  });

  async function room() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Council work", issuePrefix: `C${companyId.slice(0, 5)}`, requireBoardApprovalForNewAgents: false });
    await db.insert(issues).values({ id: issueId, companyId, title: "Work room", originKind: "council" });
    await db.insert(councilSeats).values({ companyId, issueId, name: "Chair", connectionId: randomUUID(), grantId: randomUUID(), model: "test", position: 0, fallbacks: { fallbacks: [], role: "moderator" } });
    return { companyId, issueId };
  }

  it("admits one replica and rejects both a competing start and resume while that work runs", async () => {
    const ids = await room();
    const gate = Promise.withResolvers<{ text: string }>();
    mocks.generateText
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce({ text: "Verified facts" })
      .mockResolvedValueOnce({ text: "GRADE: PASS\nNOTE: complete" })
      .mockResolvedValueOnce({ text: "Research is complete." });
    const { councilChatService } = await import("../services/council-chat.js");
    const first = councilChatService(db);
    const second = councilChatService(db);

    const admissions = await Promise.allSettled([
      first.startWork({ ...ids, userId: "alice", goal: "Research the topic" }),
      second.startWork({ ...ids, userId: "bob", goal: "Competing work" }),
    ]);
    expect(admissions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(admissions.filter((result) => result.status === "rejected")).toHaveLength(1);
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));

    await expect(second.startWork({ ...ids, userId: "bob", resume: true })).rejects.toMatchObject({ status: 409 });
    await expect(second.getWork(ids.companyId, ids.issueId)).resolves.toMatchObject({ status: "running" });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);

    gate.resolve({ text: "1. Research | assignee: Chair | expected: facts" });
    await vi.waitFor(async () => expect((await second.getWork(ids.companyId, ids.issueId)).status).toBe("done"));
  });

  it("finishes normally and persists the completed work for another service instance", async () => {
    const ids = await room();
    mocks.generateText
      .mockResolvedValueOnce({ text: "1. Research | assignee: Chair | expected: facts" })
      .mockResolvedValueOnce({ text: "Verified facts" })
      .mockResolvedValueOnce({ text: "GRADE: PASS\nNOTE: complete" })
      .mockResolvedValueOnce({ text: "Research is complete." });
    const { councilChatService } = await import("../services/council-chat.js");
    await expect(councilChatService(db).startWork({ ...ids, userId: "alice", goal: "Research the topic" })).resolves.toMatchObject({ started: true });

    await vi.waitFor(async () => {
      const rows = await db.select().from(councilWorkSessions).where(and(eq(councilWorkSessions.companyId, ids.companyId), eq(councilWorkSessions.issueId, ids.issueId)));
      expect(rows[0]).toMatchObject({ status: "done", goal: "Research the topic", summary: "Research is complete." });
    });
    await expect(councilChatService(db).getWork(ids.companyId, ids.issueId)).resolves.toMatchObject({
      status: "done", goal: "Research the topic", summary: "Research is complete.",
      steps: [{ status: "done", output: "Verified facts", grade: "pass" }],
    });
    expect(mocks.addComment).toHaveBeenCalledWith(ids.issueId, expect.stringContaining("## Work summary"), { userId: expect.stringContaining("council-seat:") });
  });

  it("takes over an expired persisted lease and resumes its unfinished steps", async () => {
    const ids = await room();
    await db.insert(councilWorkSessions).values({
      ...ids,
      goal: "Resume the report",
      status: "running",
      steps: [{ n: 1, title: "Draft", expected: "a report", assignee: "Chair", status: "running", output: "partial" }],
      summary: "work-lease:dead-owner:null",
      startedAt: new Date(Date.now() - 30 * 60_000),
      updatedAt: new Date(Date.now() - 30 * 60_000),
    });
    mocks.generateText
      .mockResolvedValueOnce({ text: "Completed draft" })
      .mockResolvedValueOnce({ text: "GRADE: PASS\nNOTE: complete" })
      .mockResolvedValueOnce({ text: "The report is complete." });
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(db);

    await expect(service.startWork({ ...ids, userId: "alice", resume: true })).resolves.toMatchObject({ started: true });
    await vi.waitFor(async () => expect((await service.getWork(ids.companyId, ids.issueId)).status).toBe("done"));
    expect(mocks.generateText).toHaveBeenCalledTimes(3);
  });
});
