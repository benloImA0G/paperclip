import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, costEvents, createDb, issues } from "@paperclipai/db";
import { costService } from "../services/costs.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("Council cost summary", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-council-costs-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(costEvents);
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("aggregates Council receipts by room and respects the selected period", async () => {
    const companyId = randomUUID();
    const firstRoomId = randomUUID();
    const secondRoomId = randomUUID();
    const otherCompanyId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Paperclip", issuePrefix: "PC", requireBoardApprovalForNewAgents: false },
      { id: otherCompanyId, name: "Other", issuePrefix: "OTH", requireBoardApprovalForNewAgents: false },
    ]);
    await db.insert(issues).values([
      { id: firstRoomId, companyId, title: "Planning room", issueNumber: 1, identifier: "PC-1" },
      { id: secondRoomId, companyId, title: "Review room", issueNumber: 2, identifier: "PC-2" },
    ]);
    await db.insert(costEvents).values([
      {
        companyId, issueId: firstRoomId, usageKind: "fast_response", billingCode: `council:${firstRoomId}`,
        provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-test",
        inputTokens: 10, outputTokens: 4, costCents: 120, occurredAt: new Date("2026-10-10T10:00:00Z"),
      },
      {
        companyId, issueId: firstRoomId, usageKind: "fast_response", billingCode: `council:${firstRoomId}`,
        provider: "openai", biller: "openai", billingType: "metered_api", costStatus: "unpriced", model: "gpt-test",
        inputTokens: 8, outputTokens: 2, costCents: 0, occurredAt: new Date("2026-10-11T10:00:00Z"),
      },
      {
        companyId, issueId: secondRoomId, usageKind: "fast_response", billingCode: `council:${secondRoomId}`,
        provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-test",
        inputTokens: 6, outputTokens: 3, costCents: 75, occurredAt: new Date("2026-10-12T10:00:00Z"),
      },
      {
        companyId, issueId: secondRoomId, usageKind: "fast_response", billingCode: "other:receipt",
        provider: "openai", biller: "openai", billingType: "metered_api", model: "gpt-test",
        inputTokens: 100, outputTokens: 100, costCents: 999, occurredAt: new Date("2026-10-12T10:00:00Z"),
      },
    ]);

    const summary = await costService(db).councilSummary(companyId, {
      from: new Date("2026-10-10T00:00:00Z"),
      to: new Date("2026-10-12T23:59:59Z"),
    });

    expect(summary).toEqual({
      callCount: 3,
      inputTokens: 24,
      outputTokens: 9,
      unpricedEventCount: 1,
      costCents: 195,
      costCentsExact: "195.0000000",
      topRooms: [
        { issueId: firstRoomId, issueTitle: "Planning room", callCount: 2, costCents: 120, costCentsExact: "120.0000000" },
        { issueId: secondRoomId, issueTitle: "Review room", callCount: 1, costCents: 75, costCentsExact: "75.0000000" },
      ],
    });
  });
});
