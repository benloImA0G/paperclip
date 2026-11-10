export function CouncilEgressBanner({ local, provider }: { local?: boolean; provider?: string }) {
  if (local !== false) return null;
  return <p className="text-(length:--text-nano) text-muted-foreground">Prompts may be sent to a cloud provider ({provider || "provider unavailable"}).</p>;
}
