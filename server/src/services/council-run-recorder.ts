import type { Db } from "@paperclipai/db";
import { appendRunEvent, type CouncilRunEventType } from "./council-run-log.js";

export type CouncilRound = {
  roomId: string;
  runId: string;
  question: string;
  seats: { name: string; status: "ok" | "error" | "skipped"; answer?: string; error?: string }[];
  summary?: string;
  exports?: { format: string; fileName: string }[];
  approvals?: { approvalId: string; action: string }[];
};

type RoundEvent = { type: CouncilRunEventType; payload: Record<string, unknown> };

export function buildRoundEvents(round: CouncilRound): RoundEvent[] {
  const events: RoundEvent[] = [{ type: "status", payload: { state: "started", question: round.question } }];
  for (const seat of round.seats) {
    if (seat.answer !== undefined) events.push({ type: "message", payload: { seat: seat.name, text: seat.answer } });
    if (seat.status === "error") events.push({ type: "error", payload: { seat: seat.name, message: seat.error ?? "Seat failed" } });
  }
  for (const approval of round.approvals ?? []) {
    events.push({ type: "approval_request", payload: { ...approval, state: "pending" } });
  }
  for (const artifact of round.exports ?? []) events.push({ type: "artifact", payload: { ...artifact } });
  if (round.summary !== undefined) events.push({ type: "message", payload: { text: round.summary, kind: "summary" } });
  events.push({ type: "status", payload: { state: round.seats.length > 0 && round.seats.every((seat) => seat.status === "error") ? "failed" : "completed" } });
  return events;
}

export async function recordRound(db: Db, companyId: string, round: CouncilRound): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const event of buildRoundEvents(round)) {
    try {
      await appendRunEvent(db, { companyId, roomId: round.roomId, runId: round.runId, ...event });
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
}
