import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issueComments, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), selectFastResponse: vi.fn(), credential: vi.fn(), addComment: vi.fn(), listComments: vi.fn(), create: vi.fn(), persistMetadata: vi.fn() }));
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
  return { select: () => ({ from: (table: unknown) => ({ where: () => query(table === issues ? [room] : table === councilSeats ? seatRows : table === issueComments ? [{ metadata: { version: 1, sections: [] } }] : []) }) }), update: () => ({ set: (value: unknown) => ({ where: async () => { mocks.persistMetadata(value); } }) }), transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.listComments.mockResolvedValue([{ authorUserId: "council-seat:earlier", body: "Earlier proposal" }]);
  mocks.generateText.mockResolvedValue({ text: "A useful answer." });
});

describe("council night engine", () => {
  afterEach(() => vi.useRealTimers());
  it("ranks three answers using blind labels", async () => {
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt.includes("You are a judge") ? "RANKING: A > B > C\nWHY: clear" : "A useful answer." }));
    const result = await councilChatService(dbFor(seats)).runRound({ ...base, mode: "ask", message: "What should we do?", ranking: true });
    expect(result.ranking?.judges).toBeGreaterThan(0);
    expect(result.ranking?.order.map((row) => row.seatName).sort()).toEqual(seats.map((s) => s.name).sort());
    const prompts = mocks.generateText.mock.calls.map(([arg]) => arg.prompt as string).filter((prompt) => prompt.includes("You are a judge"));
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt).toMatch(/Seat A/i);
      for (const value of [...seats.map((s) => s.name), ...seats.map((s) => s.connectionId), "openai"]) expect(prompt.toLowerCase()).not.toContain(value.toLowerCase());
    }
  });

  it("does not rank fewer than three answers", async () => {
    const result = await councilChatService(dbFor(seats.slice(0, 2))).runRound({ ...base, mode: "ask", message: "What should we do?", ranking: true });
    expect(result.ranking).toBeUndefined();
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });

  it.each([{ disagree: false }, { disagree: true }])("runs dissent only for unanimous agreement (disagree: $disagree)", async ({ disagree }) => {
    let answers = 0;
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt.includes("devil's advocate")) return { text: "DISSENT: STRONG\nARGUMENT: The plan has a gap." };
      answers++;
      return { text: `A reasoned position.\nSTANCE: ${disagree && answers === 2 ? "disagree" : "agree"}\nCONFIDENCE: 5` };
    });
    const result = await councilChatService(dbFor(seats)).runRound({ ...base, mode: "discuss", stance: true, dissent: true });
    const dissentCalls = mocks.generateText.mock.calls.filter(([arg]) => (arg.prompt as string).includes("devil's advocate"));
    expect(dissentCalls).toHaveLength(disagree ? 0 : 1);
    if (disagree) expect(result.dissent).toBeUndefined();
    else expect(result.dissent).toEqual({ strength: "strong", argument: "The plan has a gap." });
  });

  it("collects jury votes from seats other than the answer author", async () => {
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt.includes("You are a juror") ? "VERDICT: PASS\nWHY: sound" : "A useful answer." }));
    const result = await councilChatService(dbFor(seats)).runRound({ ...base, mode: "ask", message: "What should we do?", jury: true });
    expect(result.jury).toMatchObject({ answerSeat: "Orion", judges: 2, verdict: "pass", counts: { pass: 2, revise: 0, fail: 0 } });
    const judges = mocks.generateText.mock.calls.filter(([arg]) => (arg.prompt as string).includes("You are a juror"));
    expect(judges).toHaveLength(2);
    expect(judges.map(([arg]) => arg.system)).toEqual(expect.arrayContaining([expect.stringContaining("Lyra"), expect.stringContaining("Vega")]));
    expect(judges.every(([arg]) => !arg.system.includes("Orion"))).toBe(true);
  });

  it("synthesizes after ranking and jury with their verdicts", async () => {
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt.includes("You are a judge") ? "RANKING: A > B > C\nWHY: clear" : prompt.includes("You are a juror") ? "VERDICT: REVISE\nWHY: gap" : "A useful answer." }));
    const result = await councilChatService(dbFor([...seats, seat("Chair", "chair", "moderator")])).runRound({ ...base, mode: "ask", message: "What should we do?", ranking: true, jury: true });
    const prompts = mocks.generateText.mock.calls.map(([arg]) => arg.prompt as string);
    const synthesis = prompts.findIndex((prompt) => prompt.includes("You are the orchestrator"));
    expect(synthesis).toBeGreaterThan(prompts.reduce((last, prompt, index) => prompt.includes("You are a juror") ? index : last, -1));
    expect(prompts[synthesis]).toContain('"verdict":"revise"');
    expect(prompts[synthesis]).toContain('"ranking"');
    expect(result.jury?.verdict).toBe("revise");
    expect(prompts[synthesis]).toContain("gap");
    const stored = JSON.stringify(mocks.persistMetadata.mock.calls);
    expect(stored).toContain("Council evaluation");
    expect(stored).toContain("participants");
  });

  it("synthesizes with unavailable checks when ballots are invalid", async () => {
    mocks.generateText.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt.includes("You are a judge") || prompt.includes("You are a juror") ? "invalid ballot" : "A useful answer." }));
    await councilChatService(dbFor([...seats, seat("Chair", "chair", "moderator")])).runRound({ ...base, mode: "ask", message: "What should we do?", ranking: true, jury: true });
    const prompt = mocks.generateText.mock.calls.map(([arg]) => arg.prompt as string).find((value) => value.includes("You are the orchestrator"));
    expect(prompt).toContain('"ranking":{"unavailable":true}');
    expect(prompt).toContain('"jury":{"unavailable":true}');
  });

  it("selects a reproducible, connection-diverse panel", async () => {
    const panelSeats = [...seats, seat("Sirius", "vendor-one")];
    const service = councilChatService(dbFor(panelSeats));
    const input = { ...base, mode: "ask" as const, message: "What should we do?", panel: { size: 2, seed: 1 } };
    const first = await service.runRound(input);
    const second = await service.runRound(input);
    const selected = first.results.map((result) => result.seatId);
    expect(selected).toHaveLength(2);
    expect(second.results.map((result) => result.seatId)).toEqual(selected);
    expect(new Set(selected.map((id) => panelSeats.find((s) => s.id === id)?.connectionId)).size).toBe(2);
  });

  it("creates no tasks when createTasks is omitted", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "1. Research | assignee: worker | expected: facts" }).mockResolvedValueOnce({ text: "facts" }).mockResolvedValueOnce({ text: "GRADE: PASS NOTE: ok" }).mockResolvedValueOnce({ text: "# Summary" });
    const service = councilChatService(dbFor([seat("chair", "chair", "moderator"), seat("worker")]));
    expect(await service.startWork({ ...base, goal: "Research this" })).toMatchObject({ started: true });
    await vi.waitFor(() => expect(mocks.addComment).toHaveBeenCalledWith(issueId, expect.stringContaining("## Work summary"), { userId: "council-seat:chair" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await service.getWork(companyId, issueId)).steps).toHaveLength(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("aborts startWork during rate-limit backoff without retrying the seat", async () => {
    vi.useFakeTimers();
    mocks.generateText.mockRejectedValueOnce(new Error("429 rate limit"));
    const service = councilChatService(dbFor([seat("chair", "chair", "moderator")]));
    await service.startWork({ ...base, goal: "Research this" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await expect(service.stopWork(companyId, issueId)).resolves.toEqual({ stopped: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.getWork(companyId, issueId)).resolves.toMatchObject({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
});
