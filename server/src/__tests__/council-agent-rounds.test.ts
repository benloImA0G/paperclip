import { beforeEach, describe, expect, it, vi } from "vitest";
import { agents, councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  addComment: vi.fn(),
  listComments: vi.fn(),
  createCostEvent: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({
  selectFastResponse: vi.fn().mockResolvedValue({ provider: "test", connection: { config: { ai: { provider: "openai", method: "api_key" } } } }),
  credential: vi.fn().mockResolvedValue("credential"),
}) }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ addComment: mocks.addComment, listComments: mocks.listComments }) }));
vi.mock("../services/documents.js", () => ({ documentService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, publications: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: mocks.createCostEvent }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../services/council-export.js", () => ({ sanitizeMarkdownForPandoc: (value: string) => value }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: mocks.loggerWarn } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";

type Seat = Record<string, unknown>;

function modelSeat(id: string, role = "none"): Seat {
  return { id, name: id, persona: "", seatKind: "model", agentId: null, connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null, position: 0, createdAt: new Date() };
}

function agentSeat(id: string, role = "none"): Seat {
  return { id, name: id, persona: "Focused analyst", seatKind: "agent", agentId: `${id}-agent`, connectionId: null, grantId: null, model: null, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null, position: 1, createdAt: new Date() };
}

function dbFor(seats: Seat[]) {
  const room = { id: issueId, companyId, originKind: "council", description: "Room brief" };
  const agentRows = seats.filter((seat) => seat.seatKind === "agent").map((seat) => ({ id: seat.agentId, adapterType: "process" }));
  const rows = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : table === agents ? agentRows : [];
  const query = (value: unknown[]) => Object.assign(Promise.resolve(value), {
    orderBy: async () => value,
    limit: async () => value,
    for: async () => value,
  });
  return {
    select: () => ({ from: (table: unknown) => ({ where: () => query(rows(table)) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  } as never;
}

async function serviceFor(seats: Seat[], runAgentTurn: ReturnType<typeof vi.fn>) {
  const { councilChatService } = await import("../services/council-chat.js");
  return councilChatService(dbFor(seats), { agentTurnService: { runAgentTurn } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateText.mockResolvedValue({ text: "Model answer", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.listComments.mockResolvedValue([]);
});

describe("council agent rounds", () => {
  it("runs mixed model and agent seats through their respective turn services", async () => {
    const runAgentTurn = vi.fn().mockResolvedValue({ text: "Agent answer", model: "agent-model", durationMs: 12, usage: { inputTokens: 3, outputTokens: 2 } });
    const result = await (await serviceFor([modelSeat("model"), agentSeat("agent")], runAgentTurn)).runRound({ companyId, issueId, userId, message: "What should we do?" });

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ seatId: "model", status: "ok" }),
      expect.objectContaining({ seatId: "agent", status: "ok", text: "Agent answer" }),
    ]));
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      companyId, agentId: "agent-agent", issueId, attemptKey: `council:${result.roundId}:agent`,
      prompt: expect.stringContaining("--- BEGIN UNTRUSTED COUNCIL PROMPT ---"),
    }));
    expect(mocks.addComment).toHaveBeenCalledWith(issueId, "Agent answer", { userId: "council-seat:agent" }, expect.objectContaining({ metadata: expect.objectContaining({ councilReliability: expect.objectContaining({ durationMs: 12, fallbackUsed: false }) }) }));
  });

  it("isolates a failed agent seat without exposing its adapter error", async () => {
    const runAgentTurn = vi.fn().mockRejectedValue(new Error("adapter leaked a secret-token"));
    const result = await (await serviceFor([modelSeat("model"), agentSeat("agent")], runAgentTurn)).runRound({ companyId, issueId, userId, message: "Question" });

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ seatId: "model", status: "ok" }),
      expect.objectContaining({ seatId: "agent", status: "error", error: "Agent turn failed" }),
    ]));
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("uses an agent moderator to produce the decision card", async () => {
    const runAgentTurn = vi.fn().mockResolvedValue({ text: "### Recommendation\nUse the evidence.", durationMs: 8 });
    const result = await (await serviceFor([modelSeat("model"), agentSeat("moderator", "moderator")], runAgentTurn)).runRound({ companyId, issueId, userId, message: "Decide" });

    expect(result.results).toEqual(expect.arrayContaining([expect.objectContaining({ seatId: "moderator", orchestrator: true, status: "ok" })]));
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it("falls back from a failed agent moderator to the first active model seat", async () => {
    const runAgentTurn = vi.fn().mockRejectedValue(new Error("adapter failure"));
    mocks.generateText.mockResolvedValueOnce({ text: "Evidence from model" }).mockResolvedValueOnce({ text: "### Recommendation\nUse the fallback." });
    const result = await (await serviceFor([modelSeat("first-model"), agentSeat("moderator", "moderator")], runAgentTurn)).runRound({ companyId, issueId, userId, message: "Decide" });

    expect(result.results).toEqual(expect.arrayContaining([expect.objectContaining({ seatId: "first-model", orchestrator: true, status: "ok", fallbackUsed: true })]));
    expect(mocks.loggerWarn).toHaveBeenCalledWith(expect.objectContaining({ seatId: "moderator", fallbackSeatId: "first-model" }), expect.any(String));
  });

  it("passes Stop through to an active agent turn", async () => {
    const runAgentTurn = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const service = await serviceFor([agentSeat("agent")], runAgentTurn);
    const pending = service.runRound({ companyId, issueId, userId, message: "Question" });
    await vi.waitFor(() => expect(runAgentTurn).toHaveBeenCalled());
    await expect(service.stopRound(companyId, issueId)).resolves.toEqual({ stopped: true });
    await expect(pending).resolves.toMatchObject({ results: [expect.objectContaining({ status: "cancelled" })] });
    expect(runAgentTurn.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("does not create a second cost record for an agent turn", async () => {
    const runAgentTurn = vi.fn().mockResolvedValue({ text: "Agent answer", durationMs: 5, usage: { inputTokens: 2, outputTokens: 1 } });
    await (await serviceFor([agentSeat("agent")], runAgentTurn)).runRound({ companyId, issueId, userId, message: "Question" });
    expect(mocks.createCostEvent).not.toHaveBeenCalled();
  });
});
