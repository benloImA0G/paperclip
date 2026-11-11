import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity } from "../services/activity-log.js";
import { memoryLessonsService } from "../services/memory-lessons.js";

const extractSchema = z.object({ issueId: z.string().uuid(), maxLessons: z.number().int().min(1).max(5).default(4) }).strict();
export function memoryLessonRoutes(db: Db, deps: Parameters<typeof memoryLessonsService>[1] = {}) {
  const router = Router();
  const lessons = memoryLessonsService(db, deps);
  router.post("/companies/:companyId/memory/lessons/extract", validate(extractSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") throw forbidden("Only board users can extract lessons");
    const result = await lessons.extract(companyId, req.body.issueId, actor.actorId, req.body.maxLessons);
    for (const entry of result.created) await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "memory.created", entityType: "memory_entry", entityId: entry.id });
    res.json(result);
  });
  return router;
}
