import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  budgetPolicies,
  budgetReservations,
  companies,
  createDb,
  issues,
} from "@paperclipai/db";
import type { AdapterExecutionResult, ServerAdapterModule } from "../adapters/index.js";
import { createCouncilAgentTurnService } from "../services/council-agent-turn.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;

describeEmbedded("Council budget reservations", { timeout: 60_000 }, () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-council-budget-race-");
    db = createDb(database.connectionString);
  });

  afterAll(async () => { await database.cleanup(); });

  it("serializes parallel admission and releases a failed provider reservation", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Council budget race",
      issuePrefix: `C${companyId.slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Council room" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Council agent",
      adapterType: "hermes_gateway",
      status: "idle",
      lifecycleState: "ready",
    });
    await db.insert(budgetPolicies).values({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      amount: 40,
      reservationCents: "20",
    });

    const providerCalls = new Map<string, PromiseWithResolvers<AdapterExecutionResult>>();
    const execute = vi.fn<ServerAdapterModule["execute"]>((ctx) => {
      const attemptKey = ctx.runId.split(":")[1];
      const pending = Promise.withResolvers<AdapterExecutionResult>();
      providerCalls.set(attemptKey, pending);
      return pending.promise;
    });
    const turns = createCouncilAgentTurnService(db, {
      adapter: () => ({ type: "hermes_gateway", execute } as ServerAdapterModule),
      secrets: {
        resolveAdapterConfigForRuntime: vi.fn().mockResolvedValue({
          config: {},
          secretKeys: new Set<string>(),
          manifest: [],
        }),
      } as never,
    });
    const run = (attemptKey: string) => turns.runAgentTurn({
      companyId,
      agentId,
      issueId,
      prompt: "Answer independently",
      attemptKey,
      signal: new AbortController().signal,
    });

    const initialKeys = Array.from({ length: 4 }, () => randomUUID());
    const initialTurns = new Map(initialKeys.map((key) => [key, run(key)]));
    const initialSettled = Promise.allSettled(initialTurns.values());
    const initialFailures: unknown[] = [];
    for (const turn of initialTurns.values()) void turn.catch((error: unknown) => { initialFailures.push(error); });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      const held = await db.select().from(budgetReservations);
      expect(held.filter((row) => row.state === "held")).toHaveLength(2);
    });
    await vi.waitFor(() => expect(initialFailures.filter(
      (error) => error instanceof Error && error.message === "Budget limit reached",
    )).toHaveLength(2));

    const [failedKey, failedProvider] = providerCalls.entries().next().value!;
    failedProvider.reject(new Error("provider failed"));
    await expect(initialTurns.get(failedKey)).rejects.toMatchObject({ message: "provider failed" });

    const laterKey = randomUUID();
    const laterTurn = run(laterKey);
    await vi.waitFor(() => expect(providerCalls.has(laterKey)).toBe(true));
    providerCalls.get(laterKey)!.resolve({
      exitCode: 0,
      signal: null,
      timedOut: false,
      resultJson: { text: "later admitted" },
    });
    for (const [key, pending] of providerCalls) {
      if (key !== failedKey && key !== laterKey) pending.resolve({
        exitCode: 0,
        signal: null,
        timedOut: false,
        resultJson: { text: "parallel admitted" },
      });
    }

    await expect(laterTurn).resolves.toMatchObject({ text: "later admitted" });
    const outcomes = await initialSettled;
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason?.message === "Budget limit reached")).toHaveLength(2);
    const reservations = await db.select().from(budgetReservations);
    expect(reservations.filter((row) => row.state === "released")).toHaveLength(1);
    expect(reservations.filter((row) => row.state === "settled")).toHaveLength(2);
  });
});
