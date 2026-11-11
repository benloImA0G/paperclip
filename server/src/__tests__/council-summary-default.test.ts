import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  credential: vi.fn(),
  generateText: vi.fn(),
  listComments: vi.fn(),
  selectFastResponse: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({
  aiConnectionService: () => ({ credential: mocks.credential, selectFastResponse: mocks.selectFastResponse }),
}));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ addComment: mocks.addComment, listComments: mocks.listComments }) }));
vi.mock("../services/accounting-transaction.js", () => ({
  withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({
    insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }, []),
}));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, observations: [], policies: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));


const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";

function discussionDb(seatRows = [{ id: "seat", name: "Seat", persona: "", connectionId: "connection", grantId: "grant", model: "model", fallbacks: { fallbacks: [], role: "none" }, active: true, acceptsImages: false, reasoningEffort: null }]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  let selectCount = 0;
  const query = (value: unknown) => {
    const rows = Array.isArray(value) ? value : [value];
    return Object.assign(Promise.resolve(rows), { orderBy: async () => rows, for: async () => [room] });
  };
  return {
    select: () => ({ from: () => ({ where: () => query(++selectCount === 2 || selectCount === 6 ? seatRows : room) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.credential.mockResolvedValue("credential");
  mocks.generateText.mockResolvedValue({ text: "reply" });
  mocks.listComments.mockResolvedValue([{ authorUserId: "council-seat:earlier", body: "Earlier proposal" }]);
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
});

describe("automatic council summary", () => {
  const seat = (id: string, role: string) => ({ id, name: id, persona: "", connectionId: "connection", grantId: "grant", model: "model", fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null });

  it("dispatches the first seat when it is the moderator", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    const result = await councilChatService(discussionDb([seat("moderator", "moderator"), seat("other", "none")])).runRound({ companyId, issueId, userId, mode: "summarize" });
    expect(result.results).toEqual([expect.objectContaining({ seatId: "moderator", status: "ok" })]);
    expect(mocks.addComment).toHaveBeenCalledWith(issueId, expect.any(String), expect.objectContaining({ userId: "council-seat:moderator" }), expect.any(Object));
  });

  it("prefers a later moderator and honors an explicit writer", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    const seats = [seat("other", "none"), seat("moderator", "moderator")];
    const service = councilChatService(discussionDb(seats));
    const result = await service.runRound({ companyId, issueId, userId, mode: "summarize" });
    expect(result.results).toEqual([expect.objectContaining({ seatId: "moderator", status: "ok" })]);
    const selected = await councilChatService(discussionDb(seats)).runRound({ companyId, issueId, userId, mode: "summarize", seatId: "other" });
    expect(selected.results).toEqual([expect.objectContaining({ seatId: "other", status: "ok" })]);
  });
});
