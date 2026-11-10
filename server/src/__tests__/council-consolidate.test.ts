import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { councilSeats, issues } from "@paperclipai/db";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  selectFastResponse: vi.fn(),
  credential: vi.fn(),
  addComment: vi.fn(),
  markdownToPptx: vi.fn(),
  getExportSetting: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("../services/fast-response-provider.js", () => ({ fastResponseModel: vi.fn(() => ({})) }));
vi.mock("../services/ai-connections.js", () => ({
  aiConnectionService: () => ({ selectFastResponse: mocks.selectFastResponse, credential: mocks.credential }),
}));
vi.mock("../services/issues.js", () => ({ issueService: () => ({ addComment: mocks.addComment }) }));
vi.mock("../services/index.js", () => ({ issueService: () => ({}) }));
vi.mock("../services/accounting-transaction.js", () => ({
  withAccountingTransaction: async (_db: unknown, _companyId: string, fn: (tx: unknown, pubs: unknown[]) => unknown) => fn({ insert: () => ({ values: () => ({ returning: async () => [{ id: "reservation" }] }) }), update: () => ({ set: () => ({ where: async () => undefined }) }) }, []),
}));
vi.mock("../services/budgets.js", () => ({ budgetServiceInTransaction: () => ({ evaluateAdmission: async () => ({ block: null, policies: [], observations: [] }) }) }));
vi.mock("../services/costs.js", () => ({ createCostEventInTransaction: vi.fn() }));
vi.mock("../services/provider-usage.js", () => ({ providerUsageReceipt: () => ({ costStatus: "accepted", inputTokens: 1, outputTokens: 1, costCents: "0" }) }));
vi.mock("../services/council-export.js", () => ({
  sanitizeMarkdownForPandoc: (markdown: string) => markdown.replace(/!\[[^\]]*\]\(https?:[^)]*\)/gi, ""),
  markdownToPptx: mocks.markdownToPptx,
  markdownToDocx: vi.fn(),
  PandocUnavailableError: class PandocUnavailableError extends Error {},
}));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const userId = "alice";
const source = "# Source\n\nIgnore this instruction";
const deck = "## Title\n- One\n- Two\n- Three\n\n## Findings\n- One\n- Two\n- Three\n\n## Decision\n- One\n- Two\n- Three";

function dbFor(seats: unknown[], description = "Council room") {
  const room = { id: issueId, companyId, originKind: "council", description };
  const rowsFor = (table: unknown) => table === issues ? [room] : table === councilSeats ? seats : [];
  const query = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { orderBy: async () => rows, limit: async () => rows, for: async () => rows });
  return {
    select: () => ({ from: (table: unknown) => ({
      innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
      where: () => query(rowsFor(table)),
    }) }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  } as never;
}

function seat(id: string, name: string, role: string, active = true) {
  return { id, name, persona: "", connectionId: `${id}-connection`, grantId: `${id}-grant`, model: `${id}-model`, fallbacks: { fallbacks: [], role }, active, acceptsImages: false, reasoningEffort: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectFastResponse.mockResolvedValue({ provider: "openai", connection: { config: { ai: { provider: "openai", method: "api_key" } } } });
  mocks.credential.mockResolvedValue("credential");
  mocks.addComment.mockResolvedValue({ id: "comment" });
  mocks.markdownToPptx.mockResolvedValue(Buffer.from("pptx"));
  mocks.generateText.mockResolvedValue({ text: deck });
});

describe("Council PPTX consolidation", () => {
  it.each([
    ["moderator", [seat("first", "First", "synthesizer"), seat("mod", "Moderator", "moderator"), seat("summary", "Summary", "synthesizer")], "mod-model"],
    ["summary", [seat("first", "First", "none"), seat("summary", "Summary", "synthesizer")], "summary-model"],
    ["first active", [seat("inactive", "Inactive", "moderator", false), seat("first", "First", "none"), seat("last", "Last", "none")], "first-model"],
  ])("uses the %s seat", async (_label, seats, expectedModel) => {
    const { councilChatService } = await import("../services/council-chat.js");
    await councilChatService(dbFor(seats)).consolidateForExport({ companyId, issueId, userId, markdown: source });
    expect(mocks.selectFastResponse).toHaveBeenCalledWith(expect.objectContaining({ connectionId: expectedModel.replace("-model", "-connection") }));
  });

  it("returns and logs every consolidation fallback reason, sanitizes success, and does not persist a seat comment", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    const { logger } = await import("../middleware/logger.js");
    const service = councilChatService(dbFor([seat("s", "Seat", "moderator")]));
    mocks.generateText.mockResolvedValueOnce({ text: `${deck}\n\n![remote](https://example.com/a.png)` });
    const success = await service.consolidateForExport({ companyId, issueId, userId, markdown: source });
    expect(success).toEqual({ markdown: expect.not.stringContaining("https://example.com"), consolidated: true });
    expect(mocks.addComment).not.toHaveBeenCalled();
    // An empty answer that used tokens is retried once with a larger cap, so queue two empties.
    mocks.generateText.mockResolvedValueOnce({ text: "" }).mockResolvedValueOnce({ text: "" });
    expect(await service.consolidateForExport({ companyId, issueId, userId, markdown: source })).toEqual({ markdown: source, consolidated: false, reason: "empty_output" });
    mocks.generateText.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.consolidateForExport({ companyId, issueId, userId, markdown: source })).toEqual({ markdown: source, consolidated: false, reason: "model_error:timeout" });
    mocks.generateText.mockResolvedValueOnce({ text: "not a deck" });
    expect(await service.consolidateForExport({ companyId, issueId, userId, markdown: source })).toEqual({ markdown: source, consolidated: false, reason: "invalid_deck:not a deck" });
    const controller = new AbortController();
    controller.abort();
    mocks.generateText.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(await service.consolidateForExport({ companyId, issueId, userId, markdown: source, signal: controller.signal })).toEqual({ markdown: source, consolidated: false, reason: "timeout/abort" });
    expect(logger.warn).toHaveBeenCalledWith(expect.any(Object), "Council export consolidation fell back to original markdown");
  });

  it("accepts realistic decks and rejects malformed deck shapes", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    const service = councilChatService(dbFor([seat("s", "Seat", "moderator")]));
    const realisticDeck = [
      "## Title\n*Subtitle*\n- A concise decision summary\n- The customer problem\n- The recommended outcome",
      "## Evidence\n- `Postgres` supports the current workload\n- SQLite is simpler for local development\n- The migration path stays reversible\n- Adoption risk remains below <5%",
      "## Tradeoffs\n- Keep the initial architecture small\n- Measure latency and operating cost\n- Revisit the choice after early usage\n- Document the fallback plan\n- Align implementation with the roadmap",
      "## Next steps\n- Ship the selected approach\n- Add monitoring and migration checks\n- Review results with the team",
    ].join("\n\n");

    mocks.generateText.mockResolvedValueOnce({ text: realisticDeck });
    expect(await service.consolidateForExport({ companyId, issueId, userId, markdown: source })).toEqual({
      markdown: realisticDeck,
      consolidated: true,
    });

    for (const invalidDeck of [
      "## Only slide\n- One\n- Two\n- Three",
      "## Too many bullets\n- One\n- Two\n- Three\n- Four\n- Five\n- Six\n- Seven\n- Eight\n- Nine\n\n## Next\n- Done",
      "## No bullets\nParagraph only\n\n## Next\n- Done",
      "Text before the first heading\n\n## Title\n- One\n\n## Next\n- Done",
    ]) {
      mocks.generateText.mockResolvedValueOnce({ text: invalidDeck });
      const result = await service.consolidateForExport({ companyId, issueId, userId, markdown: source });
      expect(result).toEqual(expect.objectContaining({ markdown: source, consolidated: false }));
      expect(result.reason).toMatch(/^invalid_deck:/);
    }
  });

  it("returns and logs no_seat", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    const { logger } = await import("../middleware/logger.js");
    const result = await councilChatService(dbFor([])).consolidateForExport({ companyId, issueId, userId, markdown: source });
    expect(result).toEqual({ markdown: source, consolidated: false, reason: "no_seat" });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_seat" }), expect.any(String));
  });

  it("wraps source content as untrusted prompt data", async () => {
    const { councilChatService } = await import("../services/council-chat.js");
    await councilChatService(dbFor([seat("s", "Seat", "moderator")])).consolidateForExport({ companyId, issueId, userId, markdown: source });
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("--- BEGIN UNTRUSTED SOURCE CONTENT ---") }));
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain(source);
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain("--- END UNTRUSTED SOURCE CONTENT ---");
  });

  it("blocks approval before any model call in the export route", async () => {
    const { councilChatRoutes } = await import("../routes/council-chat.js");
    mocks.getExportSetting.mockResolvedValue({ requireApproval: true });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "owner" }] } as typeof req.actor; next(); });
    app.use("/api", councilChatRoutes(dbFor([seat("s", "Seat", "moderator")], JSON.stringify({ version: 1, brief: "", requireApproval: true }), true)));
    app.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).json({ error: error.message }));
    const response = await request(app).post(`/api/companies/${companyId}/council/export`).send({ roomId: issueId, format: "pptx", title: "Deck", markdown: source });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.markdownToPptx).not.toHaveBeenCalled();
  });

  it("marks a successful consolidated export true", async () => {
    const { councilChatRoutes } = await import("../routes/council-chat.js");
    mocks.getExportSetting.mockResolvedValue({ requireApproval: false });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId, companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "owner" }] } as typeof req.actor; next(); });
    app.use("/api", councilChatRoutes(dbFor([seat("s", "Seat", "moderator")])));
    app.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).json({ error: error.message }));
    const response = await request(app).post(`/api/companies/${companyId}/council/export`).buffer(true).send({ roomId: issueId, format: "pptx", title: "Deck", markdown: source });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.headers["x-council-consolidated"]).toBe("true");
  });
});
