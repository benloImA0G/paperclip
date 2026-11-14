import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companies, councilRunEvents, createDb, issues } from "@paperclipai/db";
import { councilRunEventRoutes } from "../routes/council-run-events.js";
import { appendRunEvent } from "../services/council-run-log.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;
describeEmbedded("Council run event routes", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let companyId: string, otherId: string, roomId: string, runId: string;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-council-run-route-");
    db = createDb(tempDb.connectionString);
  }, 120_000);
  afterAll(async () => { await db?.$client?.end?.({ timeout: 0 }); await tempDb?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); otherId = randomUUID(); roomId = randomUUID(); runId = randomUUID();
    await db.insert(companies).values([companyId, otherId].map((id) => ({ id, name: "Council", issuePrefix: `C${id.replace(/-/g, "").slice(0, 6)}` })));
    await db.insert(issues).values({ id: roomId, companyId, title: "Room", status: "todo", priority: "medium", createdByUserId: "alice" });
    await appendRunEvent(db, { companyId, roomId, runId, type: "message", payload: { text: "one" } });
    await appendRunEvent(db, { companyId, roomId, runId, type: "status", payload: { state: "running" } });
  });
  function app(actorCompany = companyId, agent = false) {
    const server = express();
    server.use((req, _res, next) => {
      req.actor = (agent ? { type: "agent", agentId: randomUUID(), companyId: actorCompany } : { type: "board", source: "session", userId: "alice", companyIds: [actorCompany], memberships: [{ companyId: actorCompany, status: "active", membershipRole: "owner" }] }) as typeof req.actor;
      next();
    });
    server.use("/api", councilRunEventRoutes(db));
    server.use((error: { status?: number; message?: string }, _req: unknown, res: express.Response, _next: unknown) => res.status(error.status ?? 500).json({ error: error.message }));
    return server;
  }
  const path = (company = companyId) => `/api/companies/${company}/council/runs/${runId}`;
  it("lists events and pages after a sequence", async () => {
    const all = await request(app()).get(`${path()}/events`);
    expect(all.status).toBe(200);
    expect(all.body.events.map((event: { sequence: number }) => event.sequence)).toEqual([1, 2]);
    const page = await request(app()).get(`${path()}/events?afterSequence=1&limit=1`);
    expect(page.body.events).toHaveLength(1);
    expect(page.body.events[0]).toMatchObject({ sequence: 2, payload: { state: "running" } });
  });
  it("replays the run", async () => {
    const response = await request(app()).get(`${path()}/replay`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ count: 2, lastStatus: "running", errors: [], pendingApprovals: [] });
  });
  it("rejects invalid pagination", async () => {
    for (const query of ["afterSequence=-1", "afterSequence=1.5", "afterSequence=", "limit=0", "limit=501", "limit=abc", "limit=1&limit=2"]) {
      expect((await request(app()).get(`${path()}/events?${query}`)).status).toBe(400);
    }
  });
  it("prevents another company and agents from reading the run", async () => {
    for (const endpoint of ["events", "replay"]) {
      expect((await request(app(otherId)).get(`${path(otherId)}/${endpoint}`)).status).toBe(404);
      expect((await request(app(otherId)).get(`${path()}/${endpoint}`)).status).toBe(403);
      expect((await request(app(companyId, true)).get(`${path()}/${endpoint}`)).status).toBe(403);
    }
  });
  it("does not expose a run whose rows span companies", async () => {
    const otherRoom = randomUUID();
    await db.insert(issues).values({ id: otherRoom, companyId: otherId, title: "Other", status: "todo", priority: "medium", createdByUserId: "alice" });
    await db.insert(councilRunEvents).values({ companyId: otherId, roomId: otherRoom, runId, sequence: 3, type: "message", payload: { text: "private" } });
    for (const endpoint of ["events", "replay"]) expect((await request(app()).get(`${path()}/${endpoint}`)).status).toBe(404);
  });
});
