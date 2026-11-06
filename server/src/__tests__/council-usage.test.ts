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
vi.mock("../services/accounting-transaction.js", () => ({
  withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []),
}));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";

const seat = (id: string, role = "none", fallbacks: unknown[] = []) => ({
  id,
  name: id,
  persona: "",
  connectionId: `${id}-connection`,
  grantId: `${id}-grant`,
  model: `${id}-model`,
  fallbacks: { fallbacks, role },
  active: true,
  acceptsImages: false,
  reasoningEffort: null,
});

function dbFor(seats: unknown[]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Council room" };
  const rowsFor = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => query(rowsFor(table)) }) }),
  } as never;
}

describe("council round usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
    mocks.credential.mockResolvedValue("credential");
    mocks.addComment.mockResolvedValue({ id: "comment" });
  });

  it("propagates generateText usage into a seat result", async () => {
    mocks.generateText.mockResolvedValue({ text: "answer", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
    const { councilChatService } = await import("../services/council-chat.js");

    const result = await councilChatService(dbFor([seat("seat")])).runRound({ companyId, issueId, userId, message: "Question" });

    expect(result.results).toEqual([expect.objectContaining({ model: "seat-model", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } })]);
  });

  it("leaves usage undefined when generateText returns none", async () => {
    mocks.generateText.mockResolvedValue({ text: "answer" });
    const { councilChatService } = await import("../services/council-chat.js");

    const result = await councilChatService(dbFor([seat("seat")])).runRound({ companyId, issueId, userId, message: "Question" });

    expect(result.results[0]).not.toHaveProperty("usage");
  });

  it("reports the usage and model of the fallback attempt that answered", async () => {
    mocks.generateText
      .mockRejectedValueOnce(new Error("primary failed"))
      .mockResolvedValueOnce({ text: "fallback answer", usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } });
    const { councilChatService } = await import("../services/council-chat.js");

    const result = await councilChatService(dbFor([seat("seat", "none", [{ connectionId: "fallback-connection", grantId: "fallback-grant", model: "fallback-model" }])])).runRound({
      companyId,
      issueId,
      userId,
      message: "Question",
    });

    expect(result.results[0]).toEqual(expect.objectContaining({ model: "fallback-model", fallbackUsed: true, usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 } }));
  });

  it("carries usage on the orchestrator result", async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: "seat answer", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } })
      .mockResolvedValueOnce({ text: "orchestrated answer", usage: { inputTokens: 15, outputTokens: 7, totalTokens: 22 } });
    const { councilChatService } = await import("../services/council-chat.js");

    const result = await councilChatService(dbFor([seat("seat"), seat("moderator", "moderator")])).runRound({ companyId, issueId, userId, message: "Question" });

    expect(result.results).toEqual([
      expect.objectContaining({ seatId: "seat", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } }),
      expect.objectContaining({ seatId: "moderator", orchestrator: true, usage: { inputTokens: 15, outputTokens: 7, totalTokens: 22 } }),
    ]);
    const orchestratorPrompt = mocks.generateText.mock.calls[1][0].prompt as string;
    expect(orchestratorPrompt).toContain("### Recommendation");
    expect(orchestratorPrompt).toContain("### Disagreement / dissent");
    expect(orchestratorPrompt).toContain("---");
    expect(orchestratorPrompt).toContain("<turn speaker=\"seat\">");
  });
});
