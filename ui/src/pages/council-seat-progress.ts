type Seat = { id: string; name: string; role?: string };
type Comment = { authorUserId?: string | null; createdAt: string | Date };

export function seatProgress({ activeSeats, targetedSeatIds, comments, roundStartedAt, now }: {
  activeSeats: Seat[]; targetedSeatIds?: string[]; comments: Comment[]; roundStartedAt: number; now: number;
}) {
  const targets = targetedSeatIds ? new Set(targetedSeatIds) : null;
  const seats = activeSeats.filter((seat) => !targets || targets.has(seat.id)).map((seat) => ({
    ...seat,
    status: comments.some((comment) => comment.authorUserId === `council-seat:${seat.id}` && new Date(comment.createdAt).getTime() >= roundStartedAt) ? "answered" as const : "waiting" as const,
  }));
  // In a chain round the orchestrator answers last, after every other seat.
  const waiting = seats.filter((seat) => seat.status === "waiting");
  const current = waiting.find((seat) => seat.role !== "moderator") ?? waiting[0];
  return { seats, current, elapsedSeconds: Math.max(0, Math.floor((now - roundStartedAt) / 1000)) };
}

export function mentionedSeatIds(message: string, seats: Seat[]): string[] | undefined {
  const lower = message.toLowerCase();
  if (/@all(?![\p{L}\p{N}_])/u.test(lower)) return undefined;
  const hit = (token: string) => new RegExp(`@${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u").test(lower);
  const full = seats.filter((seat) => hit(seat.name.toLowerCase()));
  const first = (seat: Seat) => seat.name.toLowerCase().split(/\s+/)[0] ?? "";
  const matched = full.length ? full : seats.filter((seat) => seats.filter((other) => first(other) === first(seat)).length === 1 && hit(first(seat)));
  return matched.length ? matched.map((seat) => seat.id) : undefined;
}
