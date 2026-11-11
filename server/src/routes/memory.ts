import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createMemorySchema, updateMemorySchema, withdrawMemorySchema, listMemorySchema, memoryContextSchema } from "@paperclipai/shared";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity } from "../services/activity-log.js";
import { memoryContext, MemoryDuplicateError, memoryService } from "../services/memory.js";

export function memoryRoutes(db: Db) {
  const router = Router();
  const memory = memoryService(db);
  const base = "/companies/:companyId/memory";
  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json({ entries: await memory.list(companyId, listMemorySchema.parse(req.query)) });
  });
  router.get(`${base}/context`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const filters = memoryContextSchema.parse(req.query);
    const entries = await memory.list(companyId, { ...filters, status: "active" });
    res.json({ text: memoryContext(entries), entries });
  });
  router.get(`${base}/export`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const entries = await memory.list(companyId, { status: "active" });
    const text = entries.map((entry) => `## [${entry.kind}] ${entry.title}\n\n${entry.body}\n\nSource: ${entry.sourceLabel || entry.sourceUrl || "unknown"}\n\nTags: ${entry.tags.join(", ")}\n\nDate: ${entry.createdAt.toISOString()}\n`).join("\n");
    res.type("text/markdown").send(text);
  });
  async function mutate(req: Parameters<typeof getActorInfo>[0], res: import("express").Response, action: string, operation: () => Promise<{ id: string }>, status = 200) {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    if (action !== "created" && actor.actorType !== "user") throw forbidden("Only board users can manage memory");
    try {
      const entry = await operation();
      await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: `memory.${action}`, entityType: "memory_entry", entityId: entry.id });
      res.status(status).json(entry);
    } catch (error) {
      if (error instanceof MemoryDuplicateError) { res.status(409).json({ existingId: error.existingId }); return; }
      throw error;
    }
  }
  router.post(base, validate(createMemorySchema), async (req, res) => mutate(req, res, "created", () => {
    const actor = getActorInfo(req);
    return memory.create(req.params.companyId as string, actor.actorType === "agent" ? { ...req.body, originKind: "agent" } : req.body);
  }, 201));
  router.patch(`${base}/:id`, validate(updateMemorySchema), async (req, res) => mutate(req, res, "updated", () => memory.patch(req.params.companyId as string, req.params.id as string, req.body)));
  router.post(`${base}/:id/withdraw`, validate(withdrawMemorySchema), async (req, res) => mutate(req, res, "withdrawn", () => memory.withdraw(req.params.companyId as string, req.params.id as string, req.body.reason)));
  router.post(`${base}/:id/restore`, async (req, res) => mutate(req, res, "restored", () => memory.restore(req.params.companyId as string, req.params.id as string)));
  router.post(`${base}/:id/approve`, async (req, res) => mutate(req, res, "approved", () => memory.approve(req.params.companyId as string, req.params.id as string)));
  return router;
}
