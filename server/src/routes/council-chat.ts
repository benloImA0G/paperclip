import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { COUNCIL_ROUND_ORDERS, COUNCIL_ROUND_STYLES } from "@paperclipai/shared";
import { issueService } from "../services/index.js";
import { COUNCIL_ORIGIN_KIND, councilChatService, loadCouncilDocuments, roomMetadata } from "../services/council-chat.js";
import { badRequest, conflict, forbidden, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { checkExportedFile, ExportCheckError } from "../services/council-export-check.js";
import { markdownToDocx, markdownToPptx, markdownToXlsx, PandocUnavailableError } from "../services/council-export.js";
import { getCouncilReliability } from "../services/council-reliability.js";
import { logActivity } from "../services/activity-log.js";
import { loadCouncilFollowUp } from "../services/council-followup.js";
import { getCouncilEstimate } from "../services/council-estimate.js";
import { suggestCouncilSeats } from "../services/council-autofill.js";
import { classifyCouncilQuestion } from "../services/council-modes.js";
import { friendlySeatError } from "../services/council-seat-errors.js";

const createRoomSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
const kindSchema = z.object({ kind: z.enum(["quick-fact", "decision", "brainstorm", "review", "plan-and-do"]).nullable() }).strict();
const briefSchema = z.object({ brief: z.string().max(4000) }).strict();
const exportSettingSchema = z.object({ requireApproval: z.boolean() }).strict();
const modelSeatFields = {
    name: z.string().trim().min(1).max(80),
    persona: z.string().max(2000).optional(),
    connectionId: z.string().uuid(),
    grantId: z.string().uuid(),
    model: z.string().trim().min(1).max(256),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),
    acceptsImages: z.boolean().optional(),
    role: z.enum(["none", "researcher", "builder", "critic", "synthesizer", "moderator"]).optional(),
    fallbacks: z
      .array(
        z
          .object({
            connectionId: z.string().uuid(),
            grantId: z.string().uuid(),
            model: z.string().trim().min(1).max(256),
          })
          .strict(),
      )
      .max(3)
      .optional(),
  };
const addSeatSchema = z.union([
  z.object({ kind: z.literal("agent"), agentId: z.string().uuid(), name: z.string().trim().min(1).max(80).optional(), persona: z.string().max(2000).optional(), role: z.enum(["none", "researcher", "builder", "critic", "synthesizer", "moderator"]).optional() }).strict(),
  z.object({ ...modelSeatFields, kind: z.literal("model").optional() }).strict(),
]);
const updateSeatSchema = z
  .object({
    kind: z.enum(["model", "agent"]).optional(),
    agentId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    persona: z.string().max(2000).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    active: z.boolean().optional(),
    acceptsImages: z.boolean().optional(),
    role: z.enum(["none", "researcher", "builder", "critic", "synthesizer", "moderator"]).optional(),
    fallbacks: z.array(z.object({ connectionId: z.string().uuid(), grantId: z.string().uuid(), model: z.string().trim().min(1).max(256) }).strict()).max(3).optional(),
  })
  .strict();
const roundSchema = z
  .object({
    message: z.string().trim().max(20_000).optional(),
    mode: z.enum(["ask", "discuss", "summarize"]).optional(),
    order: z.enum(COUNCIL_ROUND_ORDERS).optional(),
    style: z.enum(COUNCIL_ROUND_STYLES).optional(),
    seatId: z.string().uuid().optional(),
    repeatLast: z.boolean().optional(),
    repeatFromCommentId: z.string().uuid().optional(),
    images: z
      .array(
        z
          .object({
            mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
            data: z.string().regex(/^[A-Za-z0-9+/=]+$/).max(2_000_000),
          })
          .strict(),
      )
      .max(3)
      .optional(),
    maxOutputTokens: z.number().int().min(64).max(4096).optional(),
    clarify: z.boolean().optional(),
    stance: z.boolean().optional(),
    dissent: z.boolean().optional(),
    ranking: z.boolean().optional(),
    jury: z.boolean().optional(),
    panel: z.object({ size: z.number().int().min(2).max(8), seed: z.number().int().min(0).max(2147483647) }).strict().optional(),
    roundNumber: z.number().int().min(1).max(20).optional(),
    maxRounds: z.number().int().min(1).max(20).optional(),
  })
  .strict();
const workSchema = z.object({
  goal: z.string().trim().min(1).max(4000).optional(),
  resume: z.boolean().optional(),
  decision: z.string().max(8000).optional(),
  /** Post the goal as the user's message in the thread (plan-first asks). */
  postGoal: z.boolean().optional(),
  createTasks: z.boolean().optional(),
  juryChecks: z.boolean().optional(),
  finalReview: z.boolean().optional(),
  clarifyFirst: z.boolean().optional(),
  answers: z.array(z.object({ question: z.string().max(400), answer: z.string().max(1000) }).strict()).max(3).optional(),
}).strict().refine((value) => value.resume || value.goal !== undefined, { message: "Goal is required", path: ["goal"] });
const exportSchema = z.object({ roomId: z.string().uuid(), format: z.enum(["docx", "pptx", "xlsx"]), title: z.string().trim().min(1).max(200), markdown: z.string().min(1).max(100_000), approved: z.boolean().optional(), consolidate: z.boolean().optional() }).strict();
const artifactKeySchema = z.string().regex(/^council-output-[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid artifact key");
const artifactSchema = z.object({ key: artifactKeySchema, title: z.string().trim().min(1).max(200), markdown: z.string().trim().min(1).max(100_000) }).strict();

function exportFilename(title: string, format: "docx" | "pptx" | "xlsx") {
  const safe = title.replace(/[^\w. -]+/g, "_").trim().slice(0, 160) || "council-export";
  return `${safe}.${format}`;
}

/**
 * Council Chat (multi-vendor war rooms). A room is an issue with origin kind `council`;
 * seat replies are comments. Board users only: seats spend the company's AI connections.
 */
export function councilChatRoutes(db: Db) {
  const router = Router();
  const council = councilChatService(db);
  const issueSvc = issueService(db);

  function boardUserId(req: Parameters<typeof getActorInfo>[0]) {
    const actor = getActorInfo(req);
    if (actor.actorType !== "user") throw forbidden("Council Chat is only available to board users");
    return actor.actorId;
  }

  router.get("/companies/:companyId/council/rooms", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    if (req.query.archived === "1") {
      res.json((await council.listArchivedRooms(companyId)).map((room) => ({ ...room, kind: roomMetadata(room.description).kind ?? null })));
      return;
    }
    const rooms = await issueSvc.list(companyId, { originKind: COUNCIL_ORIGIN_KIND });
    res.json(rooms.map((room) => ({ ...room, kind: roomMetadata(room.description).kind ?? null })));
  });

  router.get("/companies/:companyId/council/connections/:connectionId/models", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const grantId = z.string().uuid().parse(req.query.grantId);
    res.json(await council.listModels(companyId, boardUserId(req), req.params.connectionId as string, grantId));
  });

  router.post("/companies/:companyId/council/rooms", validate(createRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const room = await council.createRoom(companyId, boardUserId(req), req.body);
    res.status(201).json(room);
  });

  router.get("/companies/:companyId/council/rooms/:issueId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const room = await council.getRoom(companyId, req.params.issueId as string);
    res.json({ ...room, kind: roomMetadata(room.description).kind ?? null });
  });

  router.put("/companies/:companyId/council/rooms/:issueId/kind", validate(kindSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    const issueId = req.params.issueId as string;
    const result = await council.updateKind(companyId, issueId, req.body.kind);
    await logActivity(db, { companyId, actorType: "user", actorId: userId, action: "council.kind_changed", entityType: "issue", entityId: issueId, issueId, details: { kind: result.kind } });
    res.json(result);
  });

  router.get("/companies/:companyId/council/rooms/:issueId/brief", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.getBrief(companyId, req.params.issueId as string));
  });

  router.get("/companies/:companyId/council/rooms/:issueId/documents/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    await council.getRoom(companyId, issueId);
    const { documents, maxDocuments } = await loadCouncilDocuments(db, companyId, issueId);
    res.json({ documents, maxDocuments });
  });

  router.get("/companies/:companyId/council/rooms/:issueId/stats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    await council.getRoom(companyId, req.params.issueId as string);
    res.json(await getCouncilReliability(db, companyId, req.params.issueId as string));
  });

  router.get("/companies/:companyId/council/rooms/:roomId/follow-up", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const room = await council.getRoom(companyId, req.params.roomId as string);
    res.json(await loadCouncilFollowUp(db, companyId, room.id));
  });

  router.get("/companies/:companyId/council/rooms/:roomId/estimate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const mode = req.query.mode ?? "ask";
    if (mode !== "ask" && mode !== "discuss" && mode !== "summarize") throw badRequest("Invalid estimate mode");
    const clarify = req.query.clarify === "true";
    if (req.query.clarify !== undefined && req.query.clarify !== "true" && req.query.clarify !== "false") throw badRequest("Invalid clarify value");
    res.json(await getCouncilEstimate(db, companyId, req.params.roomId as string, mode, clarify));
  });

  // Suggest how to run a question (kind, mode, rounds, seats). Heuristic only: no model call, no cost.
  router.post("/companies/:companyId/council/classify", validate(z.object({ text: z.string().max(4000) }).strict()), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(classifyCouncilQuestion(req.body.text));
  });

  router.put("/companies/:companyId/council/rooms/:issueId/brief", validate(briefSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.updateBrief(companyId, req.params.issueId as string, req.body.brief));
  });

  router.get("/companies/:companyId/council/rooms/:issueId/artifacts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.listArtifacts(companyId, req.params.issueId as string));
  });

  router.get("/companies/:companyId/council/rooms/:issueId/artifacts/:key", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw unprocessable("Invalid artifact revision");
    res.json(await council.getArtifact(companyId, req.params.issueId as string, req.params.key as string, revision));
  });

  router.post("/companies/:companyId/council/rooms/:issueId/artifacts", validate(artifactSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    res.status(201).json(await council.saveArtifact(companyId, req.params.issueId as string, userId, req.body));
  });

  router.post("/companies/:companyId/council/rooms/:issueId/artifacts/:key/review", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });
    const result = await council.reviewArtifact({ companyId, issueId: req.params.issueId as string, userId, key: req.params.key as string, signal: abort.signal });
    await logActivity(db, { companyId, actorType: "user", actorId: userId, action: "council.artifact_reviewed", entityType: "issue", entityId: req.params.issueId as string, issueId: req.params.issueId as string, details: { key: req.params.key, revision: result.revision, baseRevision: result.revision - 1, failedCritiquePersistences: result.failedCritiquePersistences } });
    res.json(result);
  });

  router.get("/companies/:companyId/council/rooms/:issueId/export-setting", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.getExportSetting(companyId, req.params.issueId as string));
  });

  router.put("/companies/:companyId/council/rooms/:issueId/export-setting", validate(exportSettingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const issueId = req.params.issueId as string;
    const result = await council.updateExportSetting(companyId, issueId, req.body.requireApproval);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      ...actor,
      action: "council.export_setting_changed",
      entityType: "issue",
      entityId: issueId,
      issueId,
      details: { requireApproval: result.requireApproval },
    });
    res.json(result);
  });

  router.get("/companies/:companyId/council/rooms/:issueId/seats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    await council.getRoom(companyId, req.params.issueId as string);
    res.json(await council.listSeats(companyId, req.params.issueId as string));
  });

  router.post("/companies/:companyId/council/rooms/:roomId/seats/suggest", validate(z.object({ count: z.number().int().min(1).max(8), seed: z.number().int().min(0).max(2147483647).optional() }).strict()), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const proposals = await suggestCouncilSeats(db, companyId, boardUserId(req), req.params.roomId as string, req.body);
    res.json({ proposals });
  });

  router.post("/companies/:companyId/council/rooms/:issueId/seats", validate(addSeatSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.status(201).json(await council.addSeat(companyId, req.params.issueId as string, req.body));
  });

  router.patch(
    "/companies/:companyId/council/rooms/:issueId/seats/:seatId",
    validate(updateSeatSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      boardUserId(req);
      res.json(
        await council.updateSeat(companyId, req.params.issueId as string, req.params.seatId as string, req.body),
      );
    },
  );

  router.delete("/companies/:companyId/council/rooms/:issueId/messages", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    await council.clearMessages(companyId, req.params.issueId as string);
    res.status(204).end();
  });

  // Fork: copy the room's seats and brief plus the thread up to one message into a new room.
  router.post("/companies/:companyId/council/rooms/:issueId/fork", validate(z.object({ upToCommentId: z.string().uuid() }).strict()), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await council.forkRoom(companyId, boardUserId(req), req.params.issueId as string, req.body);
    res.status(201).json(result);
  });

  router.delete("/companies/:companyId/council/rooms/:issueId/seats/:seatId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    await council.removeSeat(companyId, req.params.issueId as string, req.params.seatId as string);
    res.status(204).end();
  });

  router.post("/companies/:companyId/council/rooms/:issueId/rounds", validate(roundSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    if (req.body.message) {
      try {
        await council.updateKind(companyId, req.params.issueId as string, classifyCouncilQuestion(req.body.message).kind, true);
      } catch {
        // Classification is optional and must not prevent the round from running.
      }
    }
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const round = await council.runRound({
      companyId,
      issueId: req.params.issueId as string,
      userId,
      message: req.body.message,
      mode: req.body.mode,
      order: req.body.order,
      style: req.body.style,
      seatId: req.body.seatId,
      repeatLast: req.body.repeatLast,
      repeatFromCommentId: req.body.repeatFromCommentId,
      images: req.body.images,
      maxOutputTokens: req.body.maxOutputTokens,
      clarify: req.body.clarify,
      stance: req.body.stance,
      dissent: req.body.dissent,
      ranking: req.body.ranking,
      jury: req.body.jury,
      panel: req.body.panel,
      roundNumber: req.body.roundNumber,
      maxRounds: req.body.maxRounds,
      signal: abort.signal,
    });
    // Seat failures are shown to a beginner: plain wording, no URLs or keys (the raw text stays out of the response).
    res.json({
      ...round,
      results: round.results.map((result) => {
        const plainAttempts = result.failedAttempts?.map((attempt) => ({ ...attempt, error: friendlySeatError(attempt.error) }));
        const withAttempts = plainAttempts ? { ...result, failedAttempts: plainAttempts } : result;
        return withAttempts.status === "error" && withAttempts.error ? { ...withAttempts, error: friendlySeatError(withAttempts.error) } : withAttempts;
      }),
    });
  });

  // Quick health check of every active seat; nothing is written to the room.
  router.post("/companies/:companyId/council/rooms/:issueId/seats/check", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const checked = await council.checkSeats({ companyId, issueId: req.params.issueId as string, userId, signal: abort.signal });
    res.json({
      results: checked.results.map((raw) => {
        // Never send raw provider text: plain wording for the error and for the main model's failure.
        const result = "primaryError" in raw && typeof raw.primaryError === "string" ? { ...raw, primaryError: friendlySeatError(raw.primaryError) } : raw;
        return result.error && !("plainError" in result && result.plainError) ? { ...result, error: friendlySeatError(result.error) } : result;
      }),
    });
  });

  router.post("/companies/:companyId/council/rooms/:issueId/rounds/stop", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const issueId = req.params.issueId as string;
    const result = await council.stopRound(companyId, issueId);
    if (result.stopped) {
      const actor = getActorInfo(req);
      await logActivity(db, { companyId, ...actor, action: "council.round_stopped", entityType: "issue", entityId: issueId, issueId });
    }
    res.json(result);
  });

  router.post("/companies/:companyId/council/rooms/:issueId/work", validate(workSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    res.status(202).json(await council.startWork({ companyId, issueId: req.params.issueId as string, userId, ...req.body }));
  });

  router.get("/companies/:companyId/council/rooms/:issueId/work", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.getWork(companyId, req.params.issueId as string));
  });

  router.post("/companies/:companyId/council/rooms/:issueId/work/stop", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    res.json(await council.stopWork(companyId, req.params.issueId as string));
  });

  router.post("/companies/:companyId/council/export", validate(exportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const userId = boardUserId(req);
    const abort = new AbortController();
    const deadline = AbortSignal.timeout(45_000);
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const { roomId, format, title, markdown, approved } = req.body;
    // This confirmation is client-asserted for the single board user, not a security boundary.
    if ((await council.getExportSetting(companyId, roomId)).requireApproval && approved !== true) {
      throw conflict("This room requires approval before export");
    }
    const shouldConsolidate = format === "pptx" && req.body.consolidate !== false;
    const source = shouldConsolidate ? await council.consolidateForExport({ companyId, issueId: roomId, userId, markdown, signal: AbortSignal.any([abort.signal, deadline]) }) : { markdown, consolidated: false };
    let bytes: Buffer;
    try {
      bytes = format === "docx" ? await markdownToDocx(title, source.markdown) : format === "xlsx" ? await markdownToXlsx(source.markdown, title) : await markdownToPptx(title, source.markdown);
    } catch (error) {
      if (error instanceof PandocUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      throw error;
    }
    try {
      checkExportedFile(format, bytes);
    } catch (error) {
      if (error instanceof ExportCheckError) {
        res.status(502).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.setHeader("Content-Type", format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("X-Council-Consolidated", String(source.consolidated));
    res.setHeader("Access-Control-Expose-Headers", "X-Council-Consolidated");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(title, format)}"`);
    res.send(bytes);
  });

  return router;
}
