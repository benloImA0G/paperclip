import { and, asc, eq, isNull } from "drizzle-orm";
import { councilSeats, issueComments, type Db } from "@paperclipai/db";
import { COUNCIL_SEAT_AUTHOR_PREFIX } from "./council-chat.js";

type ReliabilityComment = {
  authorUserId: string | null;
  metadata: { councilReliability?: { durationMs?: number; fallbackUsed?: boolean } } | null;
};

export function calculateCouncilReliability(
  seats: Array<{ id: string; name: string }>,
  comments: ReliabilityComment[],
) {
  const bySeat = new Map(seats.map((seat) => [seat.id, [] as ReliabilityComment[]]));
  for (const comment of comments) {
    const seatId = comment.authorUserId?.startsWith(COUNCIL_SEAT_AUTHOR_PREFIX)
      ? comment.authorUserId.slice(COUNCIL_SEAT_AUTHOR_PREFIX.length)
      : null;
    if (seatId && bySeat.has(seatId)) bySeat.get(seatId)!.push(comment);
  }
  const summarize = (items: ReliabilityComment[]) => {
    const durations = items.map((item) => item.metadata?.councilReliability?.durationMs).filter((value): value is number => typeof value === "number");
    const fallbacks = items.map((item) => item.metadata?.councilReliability?.fallbackUsed).filter((value): value is boolean => typeof value === "boolean");
    return {
      replies: items.length,
      averageLatencyMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      fallbackRate: fallbacks.length ? fallbacks.filter(Boolean).length / fallbacks.length : null,
    };
  };
  const seatStats = seats.map((seat) => ({ seatId: seat.id, seatName: seat.name, ...summarize(bySeat.get(seat.id) ?? []) }));
  return { seats: seatStats, totals: summarize(comments.filter((comment) => comment.authorUserId?.startsWith(COUNCIL_SEAT_AUTHOR_PREFIX))) };
}

export async function getCouncilReliability(db: Db, companyId: string, issueId: string) {
  const seats = await db.select({ id: councilSeats.id, name: councilSeats.name }).from(councilSeats)
    .where(and(eq(councilSeats.companyId, companyId), eq(councilSeats.issueId, issueId))).orderBy(asc(councilSeats.position));
  const comments = await db.select({ authorUserId: issueComments.authorUserId, metadata: issueComments.metadata }).from(issueComments)
    .where(and(eq(issueComments.companyId, companyId), eq(issueComments.issueId, issueId), isNull(issueComments.deletedAt)));
  return calculateCouncilReliability(seats, comments);
}
