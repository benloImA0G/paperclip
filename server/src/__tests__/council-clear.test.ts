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
vi.mock("../services/ai-connections.js", () => ({
  aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }),
}));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: async () => [], addComment: mocks.addComment }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";

const seat = (id: string, role = "none") => ({ id, name: id, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null });

function dbFor(seats: unknown[], comments: unknown[] = []) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const rowsFor = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => query(rowsFor(table)) }) }),
    delete: () => ({ where: async () => { comments.length = 0; } }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as never;
}

describe("council clear cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
    mocks.credential.mockResolvedValue("credential");
    mocks.addComment.mockResolvedValue({ id: "comment" });
  });

  it("cancels a late seat, rejects clearing while running, then clears and persists a new round; no orchestrator runs after cancellation", async () => {
    const seats = [seat("seat"), seat("moderator", "moderator")];
    const pending = Promise.withResolvers<{ text: string }>();
    mocks.generateText.mockReturnValueOnce(pending.promise);
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(dbFor(seats));
    const round = service.runRound({ companyId, issueId, userId, message: "Question" });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    await expect(service.clearMessages(companyId, issueId)).rejects.toMatchObject({ status: 409 });
    service.__test__invalidateRoomGeneration(issueId);
    pending.resolve({ text: "late reply" });
    const cancelled = await round;
    expect(cancelled.results).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.addComment).not.toHaveBeenCalledWith(issueId, "late reply", expect.anything());
    expect(mocks.generateText).toHaveBeenCalledTimes(1);

    await expect(service.clearMessages(companyId, issueId)).resolves.toBeUndefined();
    mocks.generateText.mockResolvedValueOnce({ text: "normal reply" }).mockResolvedValueOnce({ text: "normal synthesis" });
    const next = await service.runRound({ companyId, issueId, userId, message: "Next" });
    expect(next.results).toEqual([
      expect.objectContaining({ status: "ok", text: "normal reply" }),
      expect.objectContaining({ status: "ok", text: "normal synthesis", orchestrator: true }),
    ]);
    expect(mocks.addComment).toHaveBeenCalledTimes(4);
  });
});
