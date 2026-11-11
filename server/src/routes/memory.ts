import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createMemorySchema, updateMemorySchema, withdrawMemorySchema, listMemorySchema, memoryContextSchema, supersedeMemorySchema, mergeMemorySchema, tidyMemorySchema, memorySettingsSchema } from "@paperclipai/shared";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity } from "../services/activity-log.js";
import { MemoryDuplicateError, memoryService, relatedEntries } from "../services/memory.js";

export function memoryRoutes(db: Db) {
  const router = Router();
  const memory = memoryService(db);
  const base = "/companies/:companyId/memory";
  router.get(`${base}/settings`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    if (getActorInfo(req).actorType !== "user") throw forbidden("Only board users can manage memory settings");
    res.json(await memory.getSettings(companyId));
  });
  router.put(`${base}/settings`, validate(memorySettingsSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") throw forbidden("Only board users can manage memory settings");
    const settings = await memory.setSettings(companyId, req.body.autoApprove);
    await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "memory.settings_updated", entityType: "company", entityId: companyId });
    res.json(settings);
  });
  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json({ entries: await memory.list(companyId, listMemorySchema.parse(req.query)) });
  });
  router.get(`${base}/context`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const filters = memoryContextSchema.parse(req.query);
    const entries = await memory.list(companyId, { query: filters.query, limit: filters.limit, status: "active" });
    res.json(await memory.context(companyId, entries, { maxChars: filters.maxChars }));
  });
  router.get(`${base}/tidy`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await memory.tidy(companyId, tidyMemorySchema.parse(req.query).staleDays));
  });
  router.get(`${base}/:id/history`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json({ entries: await memory.history(companyId, req.params.id as string) });
  });
  router.get(`${base}/:id/related`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    if (getActorInfo(req).actorType !== "user") throw forbidden("Only board users can manage memory");
    const entry = await memory.get(companyId, req.params.id as string);
    const entries = await memory.list(companyId, { status: "active" });
    res.json({ entries: relatedEntries(entries, entry, 3) });
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
      const cause = error as { code?: string; cause?: { code?: string } };
      if (cause.code === "23505" || cause.cause?.code === "23505") { res.status(409).json({ error: "An active memory with this kind and title already exists" }); return; }
      throw error;
    }
  }
  router.post(base, validate(createMemorySchema), async (req, res) => mutate(req, res, "created", () => {
    const actor = getActorInfo(req);
    return memory.create(req.params.companyId as string, actor.actorType === "agent" ? { ...req.body, originKind: "agent" } : req.body);
  }, 201));
  router.post(`${base}/merge`, validate(mergeMemorySchema), async (req, res) => mutate(req, res, "merged", () => memory.merge(req.params.companyId as string, req.body), 201));
  router.post(`${base}/:id/supersede`, validate(supersedeMemorySchema), async (req, res) => mutate(req, res, "superseded", () => memory.supersede(req.params.companyId as string, req.params.id as string, req.body), 201));
  router.patch(`${base}/:id`, validate(updateMemorySchema), async (req, res) => mutate(req, res, "updated", () => memory.patch(req.params.companyId as string, req.params.id as string, req.body)));
  router.post(`${base}/:id/withdraw`, validate(withdrawMemorySchema), async (req, res) => mutate(req, res, "withdrawn", () => memory.withdraw(req.params.companyId as string, req.params.id as string, req.body.reason)));
  router.post(`${base}/:id/restore`, async (req, res) => mutate(req, res, "restored", () => memory.restore(req.params.companyId as string, req.params.id as string)));
  router.post(`${base}/:id/approve`, async (req, res) => mutate(req, res, "approved", () => memory.approve(req.params.companyId as string, req.params.id as string)));
  return router;
}
