import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memoryList: vi.fn(),
  listAttachments: vi.fn(),
  getObject: vi.fn(),
  addComment: vi.fn(),
  credential: vi.fn(),
  generateText: vi.fn(),
  listComments: vi.fn(),
  selectFastResponse: vi.fn(),
}));

vi.mock("../storage/index.js", () => ({ getStorageService: () => ({ getObject: mocks.getObject }) }));
vi.mock("../services/memory.js", () => ({ memoryService: () => ({ list: mocks.memoryList }), memoryContext: (entries: Array<{ title: string; body: string }>) => entries.map((entry) => `${entry.title}: ${entry.body}`).join("\n") }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({
  aiConnectionService: () => ({ credential: mocks.credential, selectFastResponse: mocks.selectFastResponse }),
}));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ addComment: mocks.addComment, listComments: mocks.listComments, listAttachments: mocks.listAttachments }) }));
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
  mocks.memoryList.mockResolvedValue([]);
  mocks.listAttachments.mockResolvedValue([]);
  mocks.getObject.mockImplementation(async () => ({ stream: Readable.from([Buffer.from("launch evidence")]) }));
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.credential.mockResolvedValue("credential");
  mocks.generateText.mockResolvedValue({ text: "reply" });
  mocks.listComments.mockResolvedValue([{ authorUserId: "council-seat:earlier", body: "Earlier proposal" }]);
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
});


const attachment = (overrides: Record<string, unknown> = {}) => ({ companyId, issueId, originalFilename: "notes.md", objectKey: "notes", contentType: "text/plain", byteSize: 15, ...overrides });
const seats = ["one", "two"].map((id) => ({ id, name: id, persona: "", connectionId: "connection", grantId: "grant", model: "model", fallbacks: { fallbacks: [], role: "none" }, active: true, acceptsImages: false, reasoningEffort: null }));

describe("council document sources", () => {
  it("stores selected document names on every seat reply", async () => {
    mocks.listAttachments.mockResolvedValue([attachment(), attachment({ originalFilename: "irrelevant.md", objectKey: "irrelevant" })]);
    mocks.getObject.mockImplementation(async (_companyId: string, key: string) => ({ stream: Readable.from([Buffer.from(key === "notes" ? "launch evidence" : "unrelated content")]) }));
    const { councilChatService } = await import("../services/council-chat.js");
    await councilChatService(discussionDb(seats)).runRound({ companyId, issueId, userId, message: "launch", mode: "ask" });
    const replies = mocks.addComment.mock.calls.filter((call) => call[2]?.userId?.startsWith("council-seat:"));
    expect(replies).toHaveLength(2);
    for (const reply of replies) expect(reply[3].metadata.councilReliability.documents).toEqual(["notes.md"]);
  });

  it("stores document names on the orchestrator reply", async () => {
    mocks.listAttachments.mockResolvedValue([attachment()]);
    const moderator = { ...seats[0], id: "moderator", fallbacks: { fallbacks: [], role: "moderator" }, active: true };
    const { councilChatService } = await import("../services/council-chat.js");
    await councilChatService(discussionDb([...seats, moderator])).runRound({ companyId, issueId, userId, message: "launch", mode: "ask" });
    const replies = mocks.addComment.mock.calls.filter((call) => call[2]?.userId?.startsWith("council-seat:"));
    expect(replies).toHaveLength(3);
    expect(replies[2][3].metadata.councilReliability.documents).toEqual(["notes.md"]);
  });

  it("omits documents when no document is supplied", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    await councilChatService(discussionDb(seats)).runRound({ companyId, issueId, userId, message: "launch", mode: "ask" });
    const replies = mocks.addComment.mock.calls.filter((call) => call[2]?.userId?.startsWith("council-seat:"));
    expect(replies).toHaveLength(2);
    for (const reply of replies) expect(reply[3].metadata.councilReliability).not.toHaveProperty("documents");
  });
});
