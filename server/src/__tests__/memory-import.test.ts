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
(support.supported ? describe : describe.skip)("memory import", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let app: express.Express;
  const company = randomUUID(), other = randomUUID();
  const path = `/api/companies/${company}/memory`;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("memory-import-");
    const db = createDb(tempDb.connectionString);
    await db.insert(companies).values([{ id: company, name: "First", issuePrefix: "ONE" }, { id: other, name: "Other", issuePrefix: "TWO" }]);
    const { memoryRoutes } = await import("../routes/memory.js");
    app = express(); app.use(express.json({ limit: "1mb" })); app.use("/api", memoryRoutes(db));
    app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err instanceof ZodError ? 400 : err.status ?? 500).json({ error: err.message }));
  }, 60_000);
  afterAll(async () => { await tempDb?.cleanup(); });
  it("imports JSON as pending and skips active and pending duplicates within the company", async () => {
    await request(app).post(path).send({ kind: "fact", title: "Active" });
    const text = JSON.stringify([{ kind: "fact", title: "Active", body: "a" }, { title: "New", body: "b", tags: ["WORK"], sourceLabel: "Mine" }, { title: "New", body: "b" }]);
    expect((await request(app).post(`${path}/import`).send({ format: "json", text })).body).toEqual({ created: 1, skippedDuplicates: 2, skippedInvalid: [] });
    const entries = (await request(app).get(path).query({ status: "pending" })).body.entries;
    expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ kind: "note", title: "New", status: "pending", createdByLabel: "Import", sourceLabel: "Mine", tags: ["work"] });
    expect((await request(app).post(`/api/companies/${other}/memory/import`).send({ format: "json", text: JSON.stringify([{ title: "New", body: "b" }]) })).body.created).toBe(1);
  });
  it("imports markdown and tags", async () => {
    const response = await request(app).post(`${path}/import`).send({ format: "markdown", text: "## First\n\nBody one\n\nTags: A, b\n\n## Second\nBody two" });
    expect(response.body.created).toBe(2);
    const entries = (await request(app).get(path).query({ status: "pending" })).body.entries;
    expect(entries.find((e: { title: string }) => e.title === "First")).toMatchObject({ kind: "note", body: "Body one", tags: ["a", "b"], sourceLabel: expect.stringMatching(/^Imported \d{4}-\d\d-\d\d$/) });
  });
  it("reports limits and rejects invalid JSON and oversized payloads", async () => {
    const entries = [{ title: "x".repeat(201), body: "a" }, { title: "large", body: "x".repeat(4001) }, ...Array.from({ length: 99 }, (_, i) => ({ title: `cap ${i}`, body: "ok" }))];
    const result = await request(app).post(`${path}/import`).send({ format: "json", text: JSON.stringify(entries) });
    expect(result.body.created).toBe(98); expect(result.body.skippedInvalid).toHaveLength(3);
    expect((await request(app).post(`${path}/import`).send({ format: "json", text: "[" })).status).toBe(400);
    expect((await request(app).post(`${path}/import`).send({ format: "markdown", text: "x".repeat(204801) })).status).toBe(400);
  });
});
