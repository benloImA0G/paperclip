export type CouncilReplyReliability = {
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  costCents?: string;
  costStatus?: string;
  provider?: string;
  model?: string;
  local?: boolean;
  fallbackUsed?: boolean;
};

type ReplyMetadata = { councilReliability?: CouncilReplyReliability | null } | null | undefined;
const validNumber = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n >= 0;

export function formatDuration(ms?: number): string {
  if (!validNumber(ms)) return "unavailable";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, "0")} s`;
}

export function formatTokens(n?: number): string {
  if (!validNumber(n)) return "unavailable";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

export function formatCost({ costCents, costStatus, local }: Pick<CouncilReplyReliability, "costCents" | "costStatus" | "local">): string {
  if (local === true) return "FREE (Local)";
  if (!costCents || /unknown|estimated[-_ ]missing/i.test(costStatus ?? "") || !/^\d+(?:\.\d+)?$/.test(costCents)) return "cost unavailable";
  const [whole, fraction = ""] = costCents.split(".");
  const digits = `${whole}${fraction}`.padStart(fraction.length + 3, "0");
  const split = digits.length - fraction.length - 2;
  const dollars = digits.slice(0, split).replace(/^0+(?=\d)/, "");
  const decimal = digits.slice(split).replace(/0+$/, "").padEnd(2, "0");
  return `$${dollars}.${decimal}${costStatus === "estimated" ? " estimated" : ""}`;
}

export function replyFooterParts(metadata: ReplyMetadata): Array<{ label: string; value: string }> {
  const reliability = metadata?.councilReliability;
  const parts = [
    { label: "duration", value: formatDuration(reliability?.durationMs) },
    { label: "tokens", value: `${formatTokens(reliability?.usage?.inputTokens)} in / ${formatTokens(reliability?.usage?.outputTokens)} out` },
    { label: "cost", value: formatCost(reliability ?? {}) },
    { label: "verification", value: "Not fact-checked" },
  ];
  if (reliability?.fallbackUsed) parts.push({ label: "fallback", value: "fallback model used" });
  return parts;
}
