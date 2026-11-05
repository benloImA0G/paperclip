import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, councilRoundClaims, councilSeats, createDb, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

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

const companyId = randomUUID();
const issueId = randomUUID();
let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;

describe("durable Council round claims", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-claims-");
    db = createDb(database.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Council", issuePrefix: "C", requireBoardApprovalForNewAgents: false });
    await db.insert(issues).values({ id: issueId, companyId, title: "Room", originKind: "council" });
    await db.insert(councilSeats).values({ companyId, issueId, name: "One", connectionId: randomUUID(), grantId: randomUUID(), model: "test", position: 0 });
  });
  afterAll(async () => { await database.cleanup(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
    mocks.credential.mockResolvedValue("credential");
    mocks.addComment.mockResolvedValue({ id: randomUUID() });
    await db.delete(councilRoundClaims);
  });

  it("allows only one of two services to hold a room claim", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const first = councilChatService(db).runRound({ companyId, issueId, userId: "alice", message: "first" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await expect(councilChatService(db).runRound({ companyId, issueId, userId: "bob", message: "second" })).rejects.toMatchObject({ status: 409 });
    pending.resolve({ text: "done" });
    await first;
  });

  it("lets Stop on a second service cancel the running service", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const firstService = councilChatService(db);
    const round = firstService.runRound({ companyId, issueId, userId: "alice", message: "first" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await expect(councilChatService(db).stopRound(companyId, issueId)).resolves.toEqual({ stopped: true });
    pending.resolve({ text: "late" });
    await expect(round).resolves.toMatchObject({ results: [expect.objectContaining({ status: "cancelled" })] });
  });

  it("takes over an expired claim", async () => {
    await db.insert(councilRoundClaims).values({ companyId, issueId, roundId: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
    mocks.generateText.mockResolvedValue({ text: "done" });
    const { councilChatService } = await import("../services/council-chat.js");
    await expect(councilChatService(db).runRound({ companyId, issueId, userId: "alice", message: "take over" })).resolves.toMatchObject({ results: [expect.objectContaining({ status: "ok" })] });
    expect(await db.select().from(councilRoundClaims).where(and(eq(councilRoundClaims.companyId, companyId), eq(councilRoundClaims.issueId, issueId)))).toEqual([]);
  });
});
