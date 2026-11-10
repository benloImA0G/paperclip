import { beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: vi.fn(), credential: vi.fn() }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ create: mocks.create, listComments: mocks.listComments, addComment: mocks.addComment }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: vi.fn() }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({}) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const newRoomId = "33333333-3333-4333-8333-333333333333";

const seatRow = (id: string, position: number) => ({
  id, name: id, persona: "p", seatKind: "model", agentId: null, connectionId: "c", grantId: "g", model: "m",
  reasoningEffort: null, acceptsImages: false, fallbacks: { fallbacks: [], role: "none" }, active: true, position, createdAt: new Date(),
});

describe("council fork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: newRoomId, title: "Room (fork)" });
    mocks.addComment.mockResolvedValue({ id: "copied" });
  });

  it("copies seats and the thread up to the chosen message, mapping seat authors to the new seats", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const room = { id: issueId, companyId, originKind: "council", title: "Room", description: "Council Chat war room" };
    const seats = [seatRow("seatA", 0), seatRow("seatB", 1)];
    const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
    const db = {
      select: () => ({ from: (table: unknown) => ({ where: () => query(table === issues ? [room] : table === councilSeats ? seats : []) }) }),
      insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => { inserted.push(v); return [{ id: `new-${v.name}` }]; } }) }),
    } as never;
    mocks.listComments.mockResolvedValue([
      { id: "c1", body: "question", authorUserId: "ben", metadata: null },
      { id: "c2", body: "answer A", authorUserId: "council-seat:seatA", metadata: { version: 1 } },
      { id: "c3", body: "answer B", authorUserId: "council-seat:seatB", metadata: null },
    ]);
    const { councilChatService } = await import("../services/council-chat.js");
    const result = await councilChatService(db).forkRoom(companyId, "ben", issueId, { upToCommentId: "c2" });
    expect(result).toMatchObject({ copiedMessages: 2, copiedSeats: 2, room: { id: newRoomId } });
    expect(inserted.map((v) => v.name)).toEqual(["seatA", "seatB"]);
    expect(inserted.every((v) => v.issueId === newRoomId)).toBe(true);
    expect(mocks.addComment).toHaveBeenCalledTimes(2);
    expect(mocks.addComment).toHaveBeenNthCalledWith(1, newRoomId, "question", { userId: "ben" }, undefined);
    expect(mocks.addComment).toHaveBeenNthCalledWith(2, newRoomId, "answer A", { userId: "council-seat:new-seatA" }, { metadata: { version: 1 } });
  });

  it("rejects a message that is not in the room", async () => {
    const room = { id: issueId, companyId, originKind: "council", title: "Room", description: "x" };
    const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, for: async () => rows });
    const db = { select: () => ({ from: () => ({ where: () => query([room]) }) }) } as never;
    mocks.listComments.mockResolvedValue([{ id: "c1", body: "q", authorUserId: "ben" }]);
    const { councilChatService } = await import("../services/council-chat.js");
    await expect(councilChatService(db).forkRoom(companyId, "ben", issueId, { upToCommentId: "nope" })).rejects.toMatchObject({ status: 404 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
