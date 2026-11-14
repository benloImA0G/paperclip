import { and, asc, eq, gt, sql } from "drizzle-orm";
import { councilRunEvents, type Db } from "@paperclipai/db";
import { redactEventPayload } from "../redaction.js";

export const COUNCIL_RUN_EVENT_TYPES = ["message", "status", "tool_call", "artifact", "evidence", "approval_request", "error"] as const;
export type CouncilRunEventType = (typeof COUNCIL_RUN_EVENT_TYPES)[number];

type Payload = Record<string, unknown>;
type RunEvent = { runId: string; sequence: number; at: Date; type: string; payload: Payload };

function truncate(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value)) return value.map(truncate);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncate(item)]));
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (e.code === "23505" && (e.constraint_name ?? e.constraint) === "council_run_events_run_sequence_idx") return true;
    current = e.cause;
  }
  return false;
}

export async function appendRunEvent(db: Db, input: {
  companyId: string; roomId: string; runId: string; type: string; payload: Payload;
}): Promise<RunEvent> {
  if (!(COUNCIL_RUN_EVENT_TYPES as readonly string[]).includes(input.type)) throw new Error(`Unknown Council run event type: ${input.type}`);
  const payload = truncate(redactEventPayload(input.payload)) as Payload;
  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await db.insert(councilRunEvents).values({
        ...input, payload,
        sequence: sql`(select coalesce(max(sequence), 0) + 1 from council_run_events where run_id = ${input.runId})`,
      }).returning();
      return { runId: row!.runId, sequence: row!.sequence, at: row!.createdAt, type: row!.type, payload: row!.payload };
    } catch (error) {
      if (attempt >= 1 || !isUniqueViolation(error)) throw error;
    }
  }
}

export async function listRunEvents(db: Db, runId: string, options: { afterSequence?: number; limit?: number } = {}): Promise<RunEvent[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 500) || 1));
  const rows = await db.select().from(councilRunEvents)
    .where(and(eq(councilRunEvents.runId, runId), gt(councilRunEvents.sequence, options.afterSequence ?? 0)))
    .orderBy(asc(councilRunEvents.sequence)).limit(limit);
  return rows.map((row) => ({ runId: row.runId, sequence: row.sequence, at: row.createdAt, type: row.type, payload: row.payload }));
}

export async function replayRun(db: Db, runId: string) {
  let afterSequence = 0;
  let count = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  let lastStatus: unknown = null;
  const errors: Payload[] = [];
  const pending = new Map<string, Payload>();
  for (;;) {
    const events = await listRunEvents(db, runId, { afterSequence, limit: 500 });
    for (const event of events) {
      count++;
      firstAt ??= event.at;
      lastAt = event.at;
      afterSequence = event.sequence;
      if (event.type === "status") lastStatus = event.payload.state ?? null;
      if (event.type === "error") errors.push(event.payload);
      if (event.type === "approval_request") {
        const key = String(event.payload.approvalId ?? event.payload.gate ?? "default");
        if (event.payload.state === "pending") pending.set(key, event.payload);
        else if (typeof event.payload.state === "string") pending.delete(key);
      }
    }
    if (events.length < 500) break;
  }
  return { count, firstAt, lastAt, lastStatus, errors, pendingApprovals: [...pending.values()] };
}
