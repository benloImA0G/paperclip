import { and, desc, eq, gt, isNull, like, ne } from "drizzle-orm";
import { costEvents, councilSeats, issueComments, issues, type Db } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { COUNCIL_ORIGIN_KIND } from "./council-chat.js";

export type CouncilEstimateMode = "ask" | "discuss" | "summarize";

const HISTORY_LIMIT = 20;
const DEFAULT_LATENCY_SECONDS = { low: 5, high: 45 };
// Mirrors the current round's bounded clarify exchange count.
const MAX_ESTIMATED_SEAT_QUESTIONS = 3;

type EstimateSeat = {
  id: string;
  name: string;
  seatKind: "model" | "agent";
  agentId: string | null;
  model: string | null;
  fallbacks: unknown;
};

function seatRole(fallbacks: unknown) {
  if (!fallbacks || typeof fallbacks !== "object" || Array.isArray(fallbacks)) return "none";
  const role = (fallbacks as { role?: unknown }).role;
  return typeof role === "string" ? role : "none";
}

function boundsFromLatency(averageMs: number | null) {
  if (averageMs === null) return DEFAULT_LATENCY_SECONDS;
  return {
    low: Math.max(1, Math.ceil(averageMs / 1_000)),
    high: Math.max(1, Math.ceil(averageMs * 2 / 1_000)),
  };
}

async function seatCostAverage(db: Db, companyId: string, seat: EstimateSeat) {
  const identity = seat.seatKind === "agent"
    ? seat.agentId ? eq(costEvents.agentId, seat.agentId) : undefined
    : seat.model ? eq(costEvents.model, seat.model) : undefined;
  if (!identity) return null;
  const rows = await db
    .select({ costCents: costEvents.costCents })
    .from(costEvents)
    .where(and(
      eq(costEvents.companyId, companyId),
      identity,
      like(costEvents.billingCode, "council:%"),
      ne(costEvents.costStatus, "unpriced"),
      gt(costEvents.costCents, 0),
    ))
    .orderBy(desc(costEvents.occurredAt), desc(costEvents.id))
    .limit(HISTORY_LIMIT);
  if (!rows.length) return null;
  return rows.reduce((total, row) => total + row.costCents, 0) / rows.length;
}

async function seatLatencyBounds(db: Db, companyId: string, roomId: string, seatId: string) {
  const comments = await db
    .select({ metadata: issueComments.metadata })
    .from(issueComments)
    .where(and(
      eq(issueComments.companyId, companyId),
      eq(issueComments.issueId, roomId),
      eq(issueComments.authorUserId, `council-seat:${seatId}`),
      isNull(issueComments.deletedAt),
    ))
    .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
    .limit(HISTORY_LIMIT);
  const durations = comments.flatMap((comment) => {
    const duration = (comment.metadata as { councilReliability?: { durationMs?: unknown } } | null)?.councilReliability?.durationMs;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? [duration] : [];
  });
  return boundsFromLatency(durations.length ? durations.reduce((total, duration) => total + duration, 0) / durations.length : null);
}

function multiply(bounds: { low: number; high: number }, calls: number) {
  return { low: bounds.low * calls, high: bounds.high * calls };
}

/**
 * A read-only planning aid. It deliberately never calls budget admission or writes usage.
 */
export async function getCouncilEstimate(db: Db, companyId: string, roomId: string, mode: CouncilEstimateMode) {
  const [room] = await db.select({ id: issues.id, originKind: issues.originKind })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.id, roomId)))
    .limit(1);
  if (!room || room.originKind !== COUNCIL_ORIGIN_KIND) throw notFound("War room not found");

  const activeSeats = await db.select({
    id: councilSeats.id,
    name: councilSeats.name,
    seatKind: councilSeats.seatKind,
    agentId: councilSeats.agentId,
    model: councilSeats.model,
    fallbacks: councilSeats.fallbacks,
  }).from(councilSeats)
    .where(and(eq(councilSeats.companyId, companyId), eq(councilSeats.issueId, roomId), eq(councilSeats.active, true)))
    .orderBy(councilSeats.position, councilSeats.createdAt) as EstimateSeat[];

  const callsBySeat = new Map(activeSeats.map((seat) => [seat.id, 0]));
  const moderator = activeSeats.find((seat) => seatRole(seat.fallbacks) === "moderator");
  const summarySeat = activeSeats[0];
  if (mode === "summarize") {
    if (summarySeat) callsBySeat.set(summarySeat.id, 1);
  } else {
    for (const seat of activeSeats) callsBySeat.set(seat.id, 1);
    // A discussion estimate includes the worst permitted one-hop question/answer exchanges.
    if (mode === "discuss" && activeSeats.length > 1) {
      for (let index = 0; index < MAX_ESTIMATED_SEAT_QUESTIONS * 2; index++) {
        const seat = activeSeats[index % activeSeats.length];
        callsBySeat.set(seat.id, (callsBySeat.get(seat.id) ?? 0) + 1);
      }
    }
  }

  const seatEstimates = await Promise.all(activeSeats.map(async (seat) => {
    const calls = callsBySeat.get(seat.id) ?? 0;
    const [averageCost, latency] = await Promise.all([
      seatCostAverage(db, companyId, seat),
      seatLatencyBounds(db, companyId, roomId, seat.id),
    ]);
    return {
      seatId: seat.id,
      label: seat.name,
      kind: seat.seatKind,
      calls,
      estimatedCostCents: averageCost === null ? null : averageCost * calls,
      basis: averageCost === null ? "none" as const : "history" as const,
      latency,
    };
  }));

  const calls = seatEstimates.reduce((total, seat) => total + seat.calls, 0);
  const priced = seatEstimates.filter((seat) => seat.estimatedCostCents !== null);
  const estimatedCostCents = priced.length
    ? {
        low: priced.reduce((total, seat) => total + seat.estimatedCostCents! * 0.5, 0),
        high: priced.reduce((total, seat) => total + seat.estimatedCostCents! * 2, 0),
      }
    : null;

  const initialSeats = mode === "summarize" ? (summarySeat ? [summarySeat.id] : []) : activeSeats.filter((seat) => seat.id !== moderator?.id || activeSeats.length === 1).map((seat) => seat.id);
  const phaseBounds = (seatIds: string[]) => seatIds.reduce(
    (bounds, seatId) => {
      const seat = seatEstimates.find((item) => item.seatId === seatId)!;
      return { low: Math.max(bounds.low, seat.latency.low), high: Math.max(bounds.high, seat.latency.high) };
    },
    { low: 0, high: 0 },
  );
  const initial = phaseBounds(initialSeats);
  const moderatorBounds = mode !== "summarize" && moderator && activeSeats.length > 1
    ? seatEstimates.find((seat) => seat.seatId === moderator.id)!.latency
    : { low: 0, high: 0 };
  const followup = mode === "discuss" && activeSeats.length > 1 ? multiply(phaseBounds(activeSeats.map((seat) => seat.id)), 2) : { low: 0, high: 0 };

  return {
    mode,
    label: "estimate" as const,
    calls,
    estimatedCostCents,
    unpricedSeats: seatEstimates.filter((seat) => seat.estimatedCostCents === null).length,
    estimatedSeconds: { low: initial.low + moderatorBounds.low + followup.low, high: initial.high + moderatorBounds.high + followup.high },
    seats: seatEstimates.map(({ latency: _latency, ...seat }) => seat),
  };
}
