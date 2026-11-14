import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { councilRunEvents, type Db } from "@paperclipai/db";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors.js";
import { listRunEvents, replayRun } from "../services/council-run-log.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function integerParam(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw badRequest(`Invalid ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw badRequest(`Invalid ${name}`);
  return parsed;
}

export function councilRunEventRoutes(db: Db) {
  const router = Router();
  async function readRun<T>(companyId: string, runId: string, read: (tx: Db) => Promise<T>): Promise<T> {
    if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(companyId).success) throw badRequest("Invalid company or run ID");
    return db.transaction(async (tx) => {
      const own = await tx.select({ id: councilRunEvents.id }).from(councilRunEvents)
        .where(and(eq(councilRunEvents.runId, runId), eq(councilRunEvents.companyId, companyId))).limit(1);
      const other = await tx.select({ id: councilRunEvents.id }).from(councilRunEvents)
        .where(and(eq(councilRunEvents.runId, runId), ne(councilRunEvents.companyId, companyId))).limit(1);
      if (!own.length || other.length) throw notFound("Council run not found");
      return read(tx as unknown as Db);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  function authorize(req: Parameters<typeof getActorInfo>[0], companyId: string) {
    assertCompanyAccess(req, companyId);
    if (getActorInfo(req).actorType !== "user") throw forbidden("Council Chat is only available to board users");
  }
  router.get("/companies/:companyId/council/runs/:runId/events", async (req, res) => {
    const companyId = req.params.companyId as string;
    authorize(req, companyId);
    const afterSequence = integerParam(req.query.afterSequence, "afterSequence", 0, 2147483647);
    const limit = integerParam(req.query.limit, "limit", 1, 500);
    const events = await readRun(companyId, req.params.runId as string, (tx) => listRunEvents(tx, req.params.runId as string, { afterSequence, limit }));
    res.json({ events });
  });
  router.get("/companies/:companyId/council/runs/:runId/replay", async (req, res) => {
    const companyId = req.params.companyId as string;
    authorize(req, companyId);
    res.json(await readRun(companyId, req.params.runId as string, (tx) => replayRun(tx, req.params.runId as string)));
  });
  return router;
}
