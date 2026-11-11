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


afterEach(() => { vi.unstubAllEnvs(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true));
}

describe("council connection concurrency", () => {
  it("limits five seats sharing a connection to two calls and admits them FIFO", async () => {
    const gates = Array.from({ length: 5 }, deferred);
    let active = 0, peak = 0, index = 0;
    mocks.generateText.mockImplementation(async () => {
      const gate = gates[index++]; active++; peak = Math.max(peak, active);
      await gate.promise; active--; return { text: "answer" };
    });
    const round = councilChatService(dbFor(gates.map((_, i) => seat(String(i), "shared")))).runRound({ ...base, mode: "ask", message: "Question" });
    await until(() => index === 2);
    for (let i = 0; i < 3; i++) { gates[i].resolve(); await until(() => index === i + 3); }
    gates[3].resolve(); gates[4].resolve();
    expect((await round).results.every((r) => r.status === "ok")).toBe(true);
    expect(peak).toBe(2);
  });
  it("allows different connections to run concurrently", async () => {
    vi.stubEnv("COUNCIL_MAX_CONCURRENT_PER_CONNECTION", "1");
    const gate = deferred();
    mocks.generateText.mockImplementation(async () => { await gate.promise; return { text: "answer" }; });
    const round = councilChatService(dbFor([seat("a", "one"), seat("b", "two")])).runRound({ ...base, mode: "ask", message: "Question" });
    await until(() => mocks.generateText.mock.calls.length === 2);
    gate.resolve(); await round;
  });
  it("removes an aborted waiter without blocking the next caller", async () => {
    const { withCouncilConnectionLimit } = await import("../services/council-rate-limit.js");
    vi.stubEnv("COUNCIL_MAX_CONCURRENT_PER_CONNECTION", "1");
    const gate = deferred(), controller = new AbortController(), order: string[] = [];
    const first = withCouncilConnectionLimit("abort", new AbortController().signal, async () => { await gate.promise; });
    const waiting = withCouncilConnectionLimit("abort", controller.signal, async () => { order.push("cancelled"); });
    const rejected = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    const next = withCouncilConnectionLimit("abort", new AbortController().signal, async () => { order.push("next"); });
    controller.abort(); await rejected; gate.resolve(); await Promise.all([first, next]);
    expect(order).toEqual(["next"]);
  });
  it("releases a slot when a model call throws", async () => {
    vi.stubEnv("COUNCIL_MAX_CONCURRENT_PER_CONNECTION", "1");
    const gate = deferred(); let calls = 0;
    mocks.generateText.mockImplementation(async () => { if (++calls === 1) { await gate.promise; throw new Error("failed"); } return { text: "answer" }; });
    const round = councilChatService(dbFor([seat("a", "error"), seat("b", "error")])).runRound({ ...base, mode: "ask", message: "Question" });
    await until(() => calls === 1); gate.resolve();
    const result = await round;
    expect(calls).toBe(2); expect(result.results.map((r) => r.status).sort()).toEqual(["error", "ok"]);
  });
  it("honors a concurrency override", async () => {
    vi.stubEnv("COUNCIL_MAX_CONCURRENT_PER_CONNECTION", "3");
    const gate = deferred();
    mocks.generateText.mockImplementation(async () => { await gate.promise; return { text: "answer" }; });
    const round = councilChatService(dbFor([seat("a", "override"), seat("b", "override"), seat("c", "override")])).runRound({ ...base, mode: "ask", message: "Question" });
    await until(() => mocks.generateText.mock.calls.length === 3); gate.resolve(); await round;
  });
});
