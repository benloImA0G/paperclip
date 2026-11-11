import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, memoryEntries } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: vi.fn(), getActorInfo: () => ({ actorType: "user", actorId: "alice" }) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
suite("memory lifecycle", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let app: express.Express;
  let db: ReturnType<typeof createDb>;
  const company = randomUUID(), other = randomUUID();
  const path = `/api/companies/${company}/memory`;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values([{ id: company, name: "First", issuePrefix: "ONE" }, { id: other, name: "Second", issuePrefix: "TWO" }]);
    const { memoryRoutes } = await import("../routes/memory.js");
    app = express(); app.use(express.json()); app.use("/api", memoryRoutes(db));
    app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err instanceof ZodError ? 400 : err.status ?? 500).json({ error: err.message }));
  }, 60_000);
  afterAll(async () => { await tempDb?.cleanup(); });
  it("supersedes and follows history within the company", async () => {
    const original = (await request(app).post(path).send({ kind: "fact", title: "Original", pinned: true })).body;
    const replacement = await request(app).post(`${path}/${original.id}/supersede`).send({ body: "new" });
    expect(replacement.status).toBe(201); expect(replacement.body.supersedesId).toBe(original.id); expect(replacement.body.pinned).toBe(true);
    const history = await request(app).get(`${path}/${replacement.body.id}/history`);
    expect(history.body.entries.map((e: { id: string }) => e.id)).toEqual([replacement.body.id, original.id]);
    expect(history.body.entries[1]).toMatchObject({ status: "withdrawn", withdrawnReason: "superseded", supersededById: replacement.body.id });
    expect((await request(app).post(`${path}/${original.id}/supersede`).send({})).status).toBe(409);
    expect((await request(app).get(`/api/companies/${other}/memory/${replacement.body.id}/history`)).status).toBe(404);
  });
  it("merges active memories and detects duplicate and stale entries", async () => {
    const first = (await request(app).post(path).send({ kind: "lesson", title: "Tidy, example", body: "common\nfirst", tags: ["one"], pinned: true })).body;
    const second = (await request(app).post(path).send({ kind: "lesson", title: "Tidy example", body: "common\nsecond", tags: ["two"] })).body;
    await db.update(memoryEntries).set({ createdAt: new Date(Date.now() - 61 * 86400000) }).where(eq(memoryEntries.id, second.id));
    const tidy = await request(app).get(`${path}/tidy`);
    expect(tidy.body.stale.map((e: { id: string }) => e.id)).toContain(second.id);
    expect((await request(app).get(`${path}/tidy`).query({ staleDays: 90 })).body.stale.map((e: { id: string }) => e.id)).not.toContain(second.id);
    const group = tidy.body.duplicates.find((g: { ids: string[] }) => g.ids.includes(first.id));
    expect(group.ids).toContain(second.id); expect(group.suggestedBody.match(/common/g)).toHaveLength(1);
    const merged = await request(app).post(`${path}/merge`).send({ ids: [first.id, second.id], title: "Combined", body: "Both" });
    expect(merged.status).toBe(201); expect(merged.body).toMatchObject({ supersedesId: first.id, pinned: true, tags: ["one", "two"] });
    expect((await request(app).post(`${path}/merge`).send({ ids: [first.id, second.id], title: "Again", body: "x" })).status).toBe(409);
    expect((await request(app).post(`/api/companies/${other}/memory/merge`).send({ ids: [first.id, second.id], title: "No", body: "x" })).status).toBe(404);
    expect((await request(app).get(`${path}/tidy`).query({ staleDays: 6 })).status).toBe(400);
  });
  it("keeps a merge pending when any input is pending and preserves links and pins", async () => {
    const { memoryService } = await import("../services/memory.js");
    const memory = memoryService(db);
    const active = await memory.create(company, { kind: "preference", title: "Active merge", pinned: true });
    const pending = await memory.create(company, { kind: "preference", title: "Pending merge", originKind: "agent" });
    const merged = await memory.merge(company, { ids: [active.id, pending.id], title: "Merged review", body: "Combined" });
    expect(merged).toMatchObject({ status: "pending", pinned: true, supersedesId: active.id });
    expect(await memory.get(company, active.id)).toMatchObject({ status: "withdrawn", supersededById: merged.id });
    expect(await memory.get(company, pending.id)).toMatchObject({ status: "withdrawn", supersededById: merged.id });
    expect((await memory.history(company, merged.id)).map((entry) => entry.id)).toEqual([merged.id, active.id]);
  });
  it("budgets context and records only included entries", async () => {
    const pinned = (await request(app).post(path).send({ kind: "fact", title: "Budget pinned", body: "p".repeat(200), pinned: true })).body;
    const otherEntry = (await request(app).post(path).send({ kind: "fact", title: "Budget second", body: "s".repeat(200) })).body;
    const result = await request(app).get(`${path}/context`).query({ query: "Budget", maxChars: 400 });
    expect(result.body.entries.map((e: { id: string }) => e.id)).toEqual([pinned.id]); expect(result.body.text.length).toBeLessThanOrEqual(400);
    const all = await request(app).get(path).query({ query: "Budget" });
    expect(all.body.entries.find((e: { id: string }) => e.id === pinned.id)).toMatchObject({ useCount: 1, lastUsedAt: expect.any(String) });
    expect(all.body.entries.find((e: { id: string }) => e.id === otherEntry.id).useCount).toBe(0);
    const minimum = await request(app).get(`${path}/context`).query({ query: "Budget pinned", maxChars: 200 });
    expect(minimum.body.entries).toHaveLength(1);
  });
});

it("returns context when usage accounting fails", async () => {
  const { memoryService } = await import("../services/memory.js");
  const db = { update: () => ({ set: () => ({ where: async () => { throw new Error("unavailable"); } }) }) };
  const entry = { id: randomUUID(), kind: "fact", title: "Fallback", body: "body", pinned: false, sourceLabel: null, sourceUrl: null, createdByLabel: "Board" };
  const result = await memoryService(db as never).context(randomUUID(), [entry as never]);
  expect(result.text).toContain("Fallback"); expect(result.entries).toHaveLength(1);
});
