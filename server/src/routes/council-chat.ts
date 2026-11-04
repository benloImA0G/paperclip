import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { issueService } from "../services/index.js";
import { COUNCIL_ORIGIN_KIND, councilChatService } from "../services/council-chat.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { markdownToDocx, markdownToPptx, PandocUnavailableError } from "../services/council-export.js";

const createRoomSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
const addSeatSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    persona: z.string().max(2000).optional(),
    connectionId: z.string().uuid(),
    grantId: z.string().uuid(),
    model: z.string().trim().min(1).max(256),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),
    acceptsImages: z.boolean().optional(),
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
  })
  .strict();
const updateSeatSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    persona: z.string().max(2000).optional(),
    model: z.string().trim().min(1).max(256).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const roundSchema = z
  .object({
    message: z.string().trim().max(20_000).optional(),
    mode: z.enum(["ask", "discuss", "summarize"]).optional(),
    seatId: z.string().uuid().optional(),
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
  })
  .strict();
const exportSchema = z.object({ format: z.enum(["docx", "pptx"]), title: z.string().trim().min(1).max(200), markdown: z.string().min(1).max(100_000) }).strict();

function exportFilename(title: string, format: "docx" | "pptx") {
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
    if (req.query.archived === "1") {
      res.json(await council.listArchivedRooms(companyId));
      return;
    }
    const rooms = await issueSvc.list(companyId, { originKind: COUNCIL_ORIGIN_KIND });
    res.json(rooms);
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

  router.get("/companies/:companyId/council/rooms/:issueId/seats", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await council.getRoom(companyId, req.params.issueId as string);
    res.json(await council.listSeats(companyId, req.params.issueId as string));
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
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    res.json(
      await council.runRound({
        companyId,
        issueId: req.params.issueId as string,
        userId,
        message: req.body.message,
        mode: req.body.mode,
        seatId: req.body.seatId,
        images: req.body.images,
        maxOutputTokens: req.body.maxOutputTokens,
        clarify: req.body.clarify,
        signal: abort.signal,
      }),
    );
  });

  router.post("/companies/:companyId/council/export", validate(exportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    boardUserId(req);
    const { format, title, markdown } = req.body;
    let bytes: Buffer;
    try {
      bytes = format === "docx" ? await markdownToDocx(title, markdown) : await markdownToPptx(title, markdown);
    } catch (error) {
      if (error instanceof PandocUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.setHeader("Content-Type", format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(title, format)}"`);
    res.send(bytes);
  });

  return router;
}
