import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, issues } from "@paperclipai/db";
import { buildRoundEvents, recordRound, type CouncilRound } from "../services/council-run-recorder.ts";
import { listRunEvents, replayRun } from "../services/council-run-log.ts";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.ts";

const round: CouncilRound = {
  roomId: "room", runId: "run", question: "Why?",
  seats: [{ name: "A", status: "ok", answer: "Yes" }, { name: "B", status: "error", error: "Oops" }, { name: "C", status: "skipped" }],
  approvals: [{ approvalId: "approval", action: "export" }],
  exports: [{ format: "md", fileName: "result.md" }], summary: "Done",
};

describe("buildRoundEvents", () => {
  it("maps round data in order without changing the input", () => {
    const original = structuredClone(round);
    expect(buildRoundEvents(round)).toEqual([
      { type: "status", payload: { state: "started", question: "Why?" } },
      { type: "message", payload: { seat: "A", text: "Yes" } },
      { type: "error", payload: { seat: "B", message: "Oops" } },
      { type: "approval_request", payload: { approvalId: "approval", action: "export", state: "pending" } },
      { type: "artifact", payload: { format: "md", fileName: "result.md" } },
      { type: "message", payload: { text: "Done", kind: "summary" } },
      { type: "status", payload: { state: "completed" } },
    ]);
    expect(round).toEqual(original);
  });
  it("fails only when all seats errored", () => {
    expect(buildRoundEvents({ ...round, seats: [{ name: "A", status: "error" }] }).at(-1)?.payload.state).toBe("failed");
    expect(buildRoundEvents({ ...round, seats: [] }).at(-1)?.payload.state).toBe("completed");
    expect(buildRoundEvents({ ...round, seats: [{ name: "A", status: "skipped" }] }).at(-1)?.payload.state).toBe("completed");
  });
});

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;
describeEmbedded("recordRound", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-council-recorder-");
    db = createDb(tempDb.connectionString);
  }, 120_000);
  afterAll(async () => {
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });
  it("persists ordered events that can be replayed and counts failed appends", async () => {
    const companyId = randomUUID(), roomId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Council", issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6)}` });
    await db.insert(issues).values({ id: roomId, companyId, title: "Room", status: "todo", priority: "medium", createdByUserId: "user-1" });
    const input = { ...round, roomId, runId };
    expect(await recordRound(db, companyId, input)).toEqual({ written: 7, failed: 0 });
    const events = await listRunEvents(db, runId);
    expect(events.map(({ type, payload }) => ({ type, payload }))).toEqual(buildRoundEvents(input));
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await replayRun(db, runId)).toMatchObject({ lastStatus: "completed", pendingApprovals: [{ approvalId: "approval", action: "export", state: "pending" }] });
    expect(await recordRound(db, randomUUID(), { ...input, runId: randomUUID() })).toEqual({ written: 0, failed: 7 });
  });
});
