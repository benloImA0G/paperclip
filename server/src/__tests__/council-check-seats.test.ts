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

describe("check council seats", () => {
  it("checks each active seat once without comments, isolates failures and preserves seat order", async () => {
    const seats = [seat("first"), seat("inactive", false), seat("failing"), seat("last")];
    mocks.selectFastResponse.mockImplementation(async ({ connectionId }: { connectionId: string }) => {
      if (connectionId === "failing-connection") throw new Error("connection failed");
      if (connectionId === "first-connection") await new Promise((resolve) => setTimeout(resolve, 10));
      return { provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } };
    });
    const { results } = await councilChatService(dbFor(seats, true)).checkSeats(base);
    expect(mocks.selectFastResponse).toHaveBeenCalledTimes(3);
    expect(mocks.selectFastResponse.mock.calls.map(([arg]) => arg.connectionId).sort()).toEqual(["failing-connection", "first-connection", "last-connection"]);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.addComment).not.toHaveBeenCalled();
    expect(results.map(({ seatId, ok }) => ({ seatId, ok }))).toEqual([{ seatId: "first", ok: true }, { seatId: "failing", ok: false }, { seatId: "last", ok: true }]);
    expect(results[1]).toMatchObject({ status: "error", error: expect.stringContaining("connection failed") });
  });
});
