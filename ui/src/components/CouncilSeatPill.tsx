import type { SeatCheck } from "../pages/council-check-memory";

export function councilSeatLocation(input: { local?: boolean | null; routingKind?: string | null; provider?: string | null }): "Local" | "Cloud" | null {
  if (typeof input.local === "boolean") return input.local ? "Local" : "Cloud";
  const routing = input.routingKind?.toLowerCase();
  if (routing === "local") return "Local";
  if (routing === "cloud") return "Cloud";
  const provider = input.provider?.toLowerCase().trim();
  if (provider === "ollama" || provider === "local") return "Local";
  if (provider && ["groq", "nvidia", "gemini", "openai"].includes(provider)) return "Cloud";
  return null;
}

export function councilSeatMayUseCloud(input: Parameters<typeof councilSeatLocation>[0]): boolean {
  return councilSeatLocation(input) !== "Local";
}

export function CouncilSeatPill(props: Parameters<typeof councilSeatLocation>[0]) {
  const location = councilSeatLocation(props);
  if (!location) return null;
  return <span className="rounded-full bg-accent px-1.5 py-0.5 text-(length:--text-nano) text-muted-foreground" title={location === "Local" ? "Prompts stay on this computer" : "Prompts are sent to the provider"}>{location}</span>;
}

export function CouncilSeatStatusDot({ status }: { status?: SeatCheck }) {
  if (!status) return null;
  const title = status.ok ? `Worked in the last check${status.seconds == null ? "" : `, ${status.seconds.toFixed(1)}s`}` : status.error || "Needs attention";
  return <span role="img" aria-label={title} title={title} className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.ok ? "bg-(--status-task-icon-done)" : "bg-destructive"}`} />;
}
