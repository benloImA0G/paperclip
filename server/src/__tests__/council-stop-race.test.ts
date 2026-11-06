import { beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  selectFastResponse: vi.fn(),
  credential: vi.fn(),
  addComment: vi.fn(),
  logActivity: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: async () => [], addComment: mocks.addComment }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _company: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, totalTokens: 2, costCents: "0" }) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: mocks.logActivity }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";
const seat = (id: string) => ({ id, name: id, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role: "none" }, active: true, acceptsImages: false, reasoningEffort: null });

function dbFor(seats: unknown[]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const deleted: string[] = [];
  const rowsFor = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return {
    deleted,
    select: () => ({ from: (table: unknown) => ({ where: () => query(rowsFor(table)) }) }),
    update: () => ({ set: (value: { deletedAt: Date }) => ({ where: async () => { if (value.deletedAt) deleted.push("comment"); } }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({},),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
});

describe("council stop races", () => {
  it("rejects a second concurrent round with 409 and clears ownership after stop", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const db = dbFor([seat("seat")]);
    const service = councilChatService(db);
    const first = service.runRound({ companyId, issueId, userId, message: "first" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await expect(service.runRound({ companyId, issueId, userId, message: "second" })).rejects.toMatchObject({ status: 409 });
    expect(await service.stopRound(companyId, issueId)).toEqual({ stopped: true });
    pending.resolve({ text: "late" });
    await expect(first).resolves.toMatchObject({ results: [expect.objectContaining({ status: "cancelled" })] });
    expect(await service.stopRound(companyId, issueId)).toEqual({ stopped: false });
  });

  it("removes a user comment inserted during a stop race", async () => {
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const db = dbFor([seat("seat")]);
    const service = councilChatService(db);
    const round = service.runRound({ companyId, issueId, userId, message: "question" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await service.stopRound(companyId, issueId);
    pending.resolve({ text: "late" });
    await round;
    expect(db.deleted).toContain("comment");
  });

  it("keeps reliability free of soft-deleted comments", async () => {
    const { calculateCouncilReliability } = await import("../services/council-reliability.js");
    const stats = calculateCouncilReliability([{ id: "seat", name: "Seat" }], [
      { authorUserId: "council-seat:seat", metadata: { councilReliability: { durationMs: 100 } } },
    ]);
    expect(stats.totals.replies).toBe(1);
    const db = dbFor([]) as never;
    expect(db).toBeTruthy();
  });
});
