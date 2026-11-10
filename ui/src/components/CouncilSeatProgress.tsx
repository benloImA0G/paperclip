export function CouncilSeatProgress({ status }: { status: "waiting" | "answered" }) {
  return status === "waiting"
    ? <span role="img" aria-label="Waiting" className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
    : <span role="img" aria-label="Answered" className="inline-flex h-2 w-2 shrink-0 items-center justify-center text-primary">✓</span>;
}
