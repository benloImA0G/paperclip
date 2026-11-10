export type SeatCheck = { ok: boolean; error?: string; seconds?: number; backupUsed?: boolean; primaryError?: string; agentSeat?: boolean };
export function seatCheckText(status: SeatCheck): string {
  if (!status.ok) return `Needs attention: ${status.error || "Check failed"}`;
  if (status.backupUsed) return `Works, but only through a backup model. Main model: ${status.primaryError || "Check failed"}`;
  if (status.agentSeat) return "Agent is ready (status checked, not contacted)";
  return `Works${status.seconds == null ? "" : ` · ${status.seconds.toFixed(1)}s`}`;
}
export type LastCheck = { at: number; seats: Record<string, SeatCheck> };
const KEY = "council.lastCheck.v1";

export function lastCheck(roomId: string, seatIds?: readonly string[]): LastCheck | null {
  try {
    const check = JSON.parse(sessionStorage.getItem(KEY) ?? "{}")[roomId] as LastCheck | undefined;
    if (!check || typeof check.at !== "number" || !check.seats || typeof check.seats !== "object") return null;
    return seatIds ? { ...check, seats: Object.fromEntries(Object.entries(check.seats).filter(([id]) => seatIds.includes(id))) } : check;
  } catch { return null; }
}

export function rememberCheck(roomId: string, results: Record<string, SeatCheck>): LastCheck {
  const check = { at: Date.now(), seats: results };
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    sessionStorage.setItem(KEY, JSON.stringify({ ...stored, [roomId]: check }));
  } catch { /* Storage may be unavailable; the current page can still display the result. */ }
  return check;
}

export function isStale(check: LastCheck, now: number, maxAgeMs = 30 * 60 * 1000): boolean {
  return now - check.at >= maxAgeMs;
}
