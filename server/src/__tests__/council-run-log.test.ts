import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, createDb, issues } from "@paperclipai/db";
import { appendRunEvent, listRunEvents, replayRun } from "../services/council-run-log.ts";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;
describeEmbedded("Council run log", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let companyId: string, roomId: string, runId: string;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-council-run-log-");
    db = createDb(tempDb.connectionString);
  }, 120_000);
  afterAll(async () => {
    await db?.$client?.end?.({ timeout: 0 });
    await tempDb?.cleanup();
  });
  beforeEach(async () => {
    companyId = randomUUID(); roomId = randomUUID(); runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Council", issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6)}` });
    await db.insert(issues).values({ id: roomId, companyId, title: "Room", status: "todo", priority: "medium", createdByUserId: "user-1" });
  });
  const append = (type: string, payload: Record<string, unknown>) => appendRunEvent(db, { companyId, roomId, runId, type, payload });
  it("assigns ordered sequences and pages after a sequence", async () => {
    for (const text of ["one", "two", "three"]) await append("message", { text });
    expect((await listRunEvents(db, runId)).map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect((await listRunEvents(db, runId, { afterSequence: 1, limit: 1 })).map((event) => event.payload.text)).toEqual(["two"]);
    expect((await listRunEvents(db, runId, { afterSequence: 2 })).map((event) => event.sequence)).toEqual([3]);
  });
  it("assigns distinct sequences to concurrent appends", async () => {
    const events = await Promise.all([append("message", { text: "one" }), append("message", { text: "two" })]);
    expect(events.map((event) => event.sequence).sort()).toEqual([1, 2]);
    expect(await listRunEvents(db, runId)).toHaveLength(2);
  });
  it("rejects unknown event types", async () => {
    await expect(append("unknown", {})).rejects.toThrow(/unknown council run event type/i);
    expect(await listRunEvents(db, runId)).toHaveLength(0);
  });
  it("redacts secrets and truncates nested long strings", async () => {
    await append("message", { password: "example-secret", nested: { text: "x".repeat(4100) } });
    const [event] = await listRunEvents(db, runId);
    expect(event!.payload.password).not.toBe("example-secret");
    expect((event!.payload.nested as { text: string }).text).toHaveLength(4000);
  });
  it("replays status, errors and approvals until resolved", async () => {
    await append("status", { state: "running" });
    await append("approval_request", { gate: "export", state: "pending" });
    await append("error", { message: "failed" });
    const pending = await replayRun(db, runId);
    expect(pending).toMatchObject({ count: 3, lastStatus: "running", errors: [{ message: "failed" }], pendingApprovals: [{ gate: "export", state: "pending" }] });
    expect(pending.firstAt).toBeInstanceOf(Date);
    expect(pending.lastAt).toBeInstanceOf(Date);
    await append("approval_request", { gate: "export", state: "approved" });
    await append("status", { state: "completed" });
    expect(await replayRun(db, runId)).toMatchObject({ count: 5, lastStatus: "completed", pendingApprovals: [] });
  });
});
