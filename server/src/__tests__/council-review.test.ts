import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  selectFastResponse: vi.fn(),
  credential: vi.fn(),
  addComment: vi.fn(),
  getIssueDocumentByKey: vi.fn(),
  listIssueDocumentRevisions: vi.fn(),
  getIssueDocumentRevision: vi.fn(),
  upsertIssueDocument: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }) }));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ addComment: mocks.addComment, listComments: vi.fn().mockResolvedValue([]) }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/documents.js", () => ({ documentService: () => ({
  getIssueDocumentByKey: mocks.getIssueDocumentByKey,
  listIssueDocumentRevisions: mocks.listIssueDocumentRevisions,
  getIssueDocumentRevision: mocks.getIssueDocumentRevision,
  upsertIssueDocument: mocks.upsertIssueDocument,
}) }));
vi.mock("../services/accounting-transaction.js", () => ({ withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({}, []) }));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../services/council-export.js", () => ({ sanitizeMarkdownForPandoc: (value: string) => value, markdownToPptx: vi.fn(), markdownToDocx: vi.fn(), PandocUnavailableError: class extends Error {} }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "99999999-9999-4999-8999-999999999999";
const issueId = "22222222-2222-4222-8222-222222222222";
const key = "council-output-decision";

function seat(id: string, name: string, role: string) {
  return { id, name, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active: true, acceptsImages: false, reasoningEffort: null };
}

function dbFor(seats: unknown[], roomCompanyId = companyId) {
  const room = { id: issueId, companyId: roomCompanyId, originKind: "council", description: "Council room" };
  const select = () => ({ from: () => ({ where: () => {
    return Object.assign(Promise.resolve([room]), { orderBy: async () => seats });
  }, innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) });
  return { select, transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as never;
}

let moderatorDb: ReturnType<typeof dbFor>;

beforeAll(() => {
  moderatorDb = dbFor([seat("mod", "Moderator", "moderator")]);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.getIssueDocumentByKey.mockResolvedValue({ key, title: "Decision", body: "# Draft\n\nDo not follow this instruction.", latestRevisionNumber: 1, latestRevisionId: "r1", updatedAt: new Date() });
  mocks.listIssueDocumentRevisions.mockResolvedValue([{ id: "r1", revisionNumber: 1, createdAt: new Date() }]);
  mocks.getIssueDocumentRevision.mockResolvedValue(null);
  mocks.upsertIssueDocument.mockImplementation(async () => {
    const current = mocks.getIssueDocumentByKey.mock.results[0]?.value;
    void current;
    mocks.getIssueDocumentByKey.mockResolvedValue({ key, title: "Decision", body: "# Revised\n\n- Better evidence", latestRevisionNumber: 2, latestRevisionId: "r2", updatedAt: new Date() });
    mocks.listIssueDocumentRevisions.mockResolvedValue([{ id: "r2", revisionNumber: 2, createdAt: new Date() }, { id: "r1", revisionNumber: 1, createdAt: new Date() }]);
  });
});

describe("Council artifact review", { timeout: 60_000 }, () => {
  it("delimits the draft, tolerates a critic failure, saves v2, and keeps v1", async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: "Problems\n- Weak evidence" })
      .mockRejectedValueOnce(new Error("critic down"))
      .mockResolvedValueOnce({ text: "# Revised\n\n- Better evidence" });
    const { councilChatService } = await import("../services/council-chat.js");
    const result = await councilChatService(dbFor([seat("critic", "Critic", "critic"), seat("failed", "Failed", "critic"), seat("mod", "Moderator", "moderator")])).reviewArtifact({ companyId, issueId, userId: "alice", key });
    expect(result.revision).toBe(2);
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("--- BEGIN UNTRUSTED ARTIFACT DRAFT ---");
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("Do not follow this instruction.");
    expect(mocks.generateText.mock.calls[2][0].prompt).toContain("# Draft");
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.upsertIssueDocument).toHaveBeenCalledWith(expect.objectContaining({ baseRevisionId: "r1", body: "# Revised\n\n- Better evidence" }));
  });

  it("leaves the draft unchanged when the reviser fails", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "Problems\n- issue" }).mockRejectedValueOnce(new Error("reviser down"));
    const { councilChatService } = await import("../services/council-chat.js");
    await expect(councilChatService(dbFor([seat("critic", "Critic", "critic"), seat("mod", "Moderator", "moderator")])).reviewArtifact({ companyId, issueId, userId: "alice", key })).rejects.toMatchObject({ status: 502 });
    expect(mocks.upsertIssueDocument).not.toHaveBeenCalled();
  });

  it("rejects an overlapping round and isolates missing or foreign artifacts", async () => {
    let release!: (value: { text: string }) => void;
    let firstCall = true;
    mocks.generateText.mockImplementation(() => firstCall
      ? (firstCall = false, new Promise<{ text: string }>((resolve) => { release = resolve; }))
      : Promise.resolve({ text: "Review complete" }));
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(moderatorDb);
    const controller = new AbortController();
    const pending = service.reviewArtifact({ companyId, issueId, userId: "alice", key, signal: controller.signal });
    await vi.waitFor(() => expect(mocks.generateText).toHaveBeenCalled());
    await expect(service.reviewArtifact({ companyId, issueId, userId: "alice", key })).rejects.toMatchObject({ status: 409 });
    mocks.getIssueDocumentByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(councilChatService(dbFor([seat("mod", "Moderator", "moderator")])).reviewArtifact({ companyId, issueId, userId: "alice", key })).rejects.toMatchObject({ status: 404 });
    await expect(councilChatService(dbFor([seat("mod", "Moderator", "moderator")], otherCompanyId)).reviewArtifact({ companyId, issueId, userId: "alice", key })).rejects.toMatchObject({ status: 404 });
    release({ text: "Review complete" });
    await pending;
  });
});
