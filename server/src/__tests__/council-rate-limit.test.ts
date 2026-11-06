import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), selectFastResponse: vi.fn(), credential: vi.fn(), addComment: vi.fn(), listComments: vi.fn(), create: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ listComments: mocks.listComments, addComment: mocks.addComment, create: mocks.create }) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

import { councilChatService } from "../services/council-chat.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";
const seat = (name: string, connectionId = name, role = "none") => ({ id: name, name, persona: "", connectionId, grantId: `${name}-grant`, model: `${name}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null });
const seats = [seat("Orion", "vendor-one"), seat("Lyra", "vendor-two"), seat("Vega", "vendor-three")];
const base = { companyId, issueId, userId };

function dbFor(seatRows: ReturnType<typeof seat>[]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return { select: () => ({ from: (table: unknown) => ({ where: () => query(table === issues ? [room] : table === councilSeats ? seatRows : []) }) }), transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.listComments.mockResolvedValue([{ authorUserId: "council-seat:earlier", body: "Earlier proposal" }]);
  mocks.generateText.mockResolvedValue({ text: "A useful answer." });
});

import { councilRateLimitDelayMs, isCouncilRateLimit } from "../services/council-rate-limit.js";
afterEach(() => vi.useRealTimers());
describe("council rate limits", () => {
  it("recognizes rate limits and parses bounded hints", () => {
    expect(isCouncilRateLimit("HTTP 429 tokens per minute")).toBe(true);
    expect(isCouncilRateLimit("connection failed")).toBe(false);
    expect(councilRateLimitDelayMs("try again in 3.5s")).toBe(4500);
    expect(councilRateLimitDelayMs("rate limit reached")).toBe(8000);
    expect(councilRateLimitDelayMs("try again in 45s")).toBe(20000);
  });
  it("retries the same seat after a rate limit", async () => {
    vi.useFakeTimers();
    mocks.generateText.mockRejectedValueOnce(new Error("Rate limit reached; try again in 1s")).mockResolvedValueOnce({ text: "Recovered answer" });
    const round = councilChatService(dbFor([seat("Orion")])).runRound({ ...base, mode: "ask", message: "Question" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await round;
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(result.results[0]).toMatchObject({ status: "ok", text: "Recovered answer", fallbackUsed: false });
  });
  it("does not retry other errors", async () => {
    mocks.generateText.mockRejectedValue(new Error("provider unavailable"));
    const result = await councilChatService(dbFor([seat("Orion")])).runRound({ ...base, mode: "ask", message: "Question" });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ status: "error" });
  });
  it("stops waiting when the round is aborted", async () => {
    vi.useFakeTimers();
    mocks.generateText.mockRejectedValue(new Error("429 rate limit"));
    const controller = new AbortController();
    const round = councilChatService(dbFor([seat("Orion")])).runRound({ ...base, mode: "ask", message: "Question", signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    controller.abort();
    const result = await round;
    expect(result.results[0]).toMatchObject({ status: "cancelled" });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
});
