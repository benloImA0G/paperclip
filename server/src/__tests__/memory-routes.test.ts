import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { ZodError } from "zod";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: vi.fn(), getActorInfo: () => ({ actorType: "user", actorId: "alice" }) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
suite("memory routes", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let app: express.Express;
  const company = randomUUID(), other = randomUUID();
  const path = `/api/companies/${company}/memory`;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-");
    const db = createDb(tempDb.connectionString);
    await db.insert(companies).values([{ id: company, name: "First", issuePrefix: "ONE" }, { id: other, name: "Second", issuePrefix: "TWO" }]);
    const { memoryRoutes } = await import("../routes/memory.js");
    app = express(); app.use(express.json()); app.use("/api", memoryRoutes(db));
    app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err instanceof ZodError ? 400 : err.status ?? 500).json({ error: err.message }));
  }, 60_000);
  afterAll(async () => { await tempDb?.cleanup(); });
  it("defaults settings on and updates them per company", async () => {
    expect((await request(app).get(`${path}/settings`)).body).toEqual({ autoApprove: true });
    expect((await request(app).put(`${path}/settings`).send({ autoApprove: false })).body).toEqual({ autoApprove: false });
    expect((await request(app).get(`${path}/settings`)).body).toEqual({ autoApprove: false });
    expect((await request(app).get(`/api/companies/${other}/memory/settings`)).body).toEqual({ autoApprove: true });
    expect((await request(app).put(`${path}/settings`).send({ autoApprove: "yes" })).status).toBe(400);
  });
  it("creates, validates, detects duplicates, filters and ranks", async () => {
    const first = await request(app).post(path).send({ kind: "fact", title: "Alpha project", body: "beta", tags: ["WORK"] });
    expect(first.status).toBe(201); expect(first.body.tags).toEqual(["work"]);
    const duplicate = await request(app).post(path).send({ kind: "fact", title: "Alpha project" });
    expect(duplicate.status).toBe(409); expect(duplicate.body.existingId).toBe(first.body.id);
    await request(app).post(path).send({ kind: "decision", title: "Beta", body: "alpha", pinned: true });
    await request(app).post(path).send({ kind: "fact", title: "Unrelated", body: "alpha beta" });
    const ranked = await request(app).get(path).query({ query: "ALPHA beta" });
    expect(ranked.body.entries.map((e: { title: string }) => e.title)).toEqual(["Beta", "Alpha project", "Unrelated"]);
    const filtered = await request(app).get(path).query({ kind: "fact", tag: "WORK" });
    expect(filtered.body.entries.map((e: { id: string }) => e.id)).toEqual([first.body.id]);
    expect((await request(app).post(path).send({ kind: "fact", title: "Bad", sourceUrl: "file:///tmp/a" })).status).toBe(400);
  });
  it("isolates companies and supports withdraw and restore", async () => {
    const created = await request(app).post(path).send({ kind: "lesson", title: "Lifecycle" });
    const id = created.body.id;
    expect((await request(app).patch(`/api/companies/${other}/memory/${id}`).send({ title: "No" })).status).toBe(404);
    expect((await request(app).get(`/api/companies/${other}/memory`)).body.entries).toEqual([]);
    expect((await request(app).post(`${path}/${id}/withdraw`).send({ reason: "old" })).body.withdrawnReason).toBe("old");
    expect((await request(app).get(path).query({ status: "withdrawn" })).body.entries[0].id).toBe(id);
    expect((await request(app).post(`${path}/${id}/restore`)).body.status).toBe("active");
  });
  it("keeps pending out of context and export until approved", async () => {
    const pending = await request(app).post(path).send({ kind: "reference", title: "Pending unique", body: "x".repeat(350), originKind: "agent", createdByLabel: "Agent", pinned: true });
    expect(pending.body.status).toBe("pending");
    expect((await request(app).post(`${path}/${pending.body.id}/restore`)).status).toBe(409);
    expect((await request(app).get(`${path}/context`).query({ query: "Pending unique" })).body.text).toBe("");
    expect((await request(app).get(`${path}/export`)).text).not.toContain("Pending unique");
    expect((await request(app).post(`${path}/${pending.body.id}/approve`)).body.status).toBe("active");
    const context = await request(app).get(`${path}/context`).query({ query: "unique" });
    expect(context.body.text).toContain(`${"x".repeat(300)} (source: unknown; by Agent)`);
    expect(context.body.text).not.toContain("x".repeat(301));
    expect((await request(app).get(`${path}/export`)).text).toContain("## [reference] Pending unique");
  });
});
