import { beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), selectFastResponse: vi.fn(), credential: vi.fn(), addComment: vi.fn(), listComments: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: mocks.listComments, addComment: mocks.addComment }) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
import { councilChatService } from "../services/council-chat.js";

const base = { companyId: "11111111-1111-4111-8111-111111111111", issueId: "22222222-2222-4222-8222-222222222222", userId: "alice" };
const seat = (id: string, active = true) => ({ id, name: id, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role: "none" }, active, acceptsImages: false, reasoningEffort: null });
function dbFor(seats: ReturnType<typeof seat>[], activeOnly = false) {
  const room = { id: base.issueId, companyId: base.companyId, originKind: "council", description: "Council room" };
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return { select: () => ({ from: (table: unknown) => ({ where: () => query(table === issues ? [room] : table === councilSeats ? (activeOnly ? seats.filter((s) => s.active) : seats) : []) }) }), transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.generateText.mockResolvedValue({ text: "A useful answer" });
});

const thread = [
  { authorUserId: "alice", body: "First question" },
  { authorUserId: "council-seat:first", body: "Old reply A" },
  { authorUserId: "alice", body: "Second question" },
  { authorUserId: "council-seat:second", body: "Old reply B" },
];
describe("repeat last council question", () => {
  it("asks only the selected seat without reposting the question or including old replies", async () => {
    mocks.listComments.mockResolvedValue(thread);
    const result = await councilChatService(dbFor([seat("first"), seat("second")])).runRound({ ...base, repeatLast: true, seatId: "second" });
    expect(result.results.map((r) => r.seatId)).toEqual(["second"]);
    expect(mocks.selectFastResponse).toHaveBeenCalledTimes(1);
    expect(mocks.selectFastResponse).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "second-connection" }));
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.addComment).toHaveBeenCalledWith(base.issueId, "A useful answer", { userId: "council-seat:second" }, expect.anything());
    const prompt = mocks.generateText.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("Second question");
    // Earlier context stays; only the replies to the question being asked again are hidden.
    expect(prompt).toContain("Old reply A");
    expect(prompt).not.toContain("Old reply B");
  });
  it("requires a selected seat", async () => {
    await expect(councilChatService(dbFor([seat("first")])).runRound({ ...base, repeatLast: true })).rejects.toMatchObject({ status: 422, message: "Choose one seat to ask again" });
  });
  it("requires a previous user question", async () => {
    mocks.listComments.mockResolvedValue([thread[1], thread[3]]);
    await expect(councilChatService(dbFor([seat("first")])).runRound({ ...base, repeatLast: true, seatId: "first" })).rejects.toThrow("no question to ask again");
  });
  it("rejects an inactive selected seat", async () => {
    mocks.listComments.mockResolvedValue(thread);
    await expect(councilChatService(dbFor([seat("first"), seat("second", false)])).runRound({ ...base, repeatLast: true, seatId: "second" })).rejects.toThrow("That seat is not active");
  });
});
