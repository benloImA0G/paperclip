import { CouncilMemoryButton, type CouncilMemoryButtonProps } from "./CouncilMemoryButton";
import { formatTokens, type CouncilReplyReliability } from "../pages/council-reply-labels";

type Reliability = Omit<CouncilReplyReliability, "costCents"> & { costCents?: number | string };
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function CouncilReplyFooter({ metadata, memory }: { metadata?: { councilReliability?: Reliability | null; documents?: string[] } | null; memory?: CouncilMemoryButtonProps }) {
  const reply = metadata?.councilReliability;
  const parts: string[] = [];
  const unavailable = ["First-token time is not measured yet"];
  if (measured(reply?.durationMs)) parts.push(`${(reply.durationMs / 1000).toFixed(1)}s`);
  else unavailable.push("Total time unavailable");
  if (measured(reply?.usage?.inputTokens)) parts.push(`${formatTokens(reply.usage.inputTokens)} in`);
  else unavailable.push("Input tokens unavailable");
  if (measured(reply?.usage?.outputTokens)) parts.push(`${formatTokens(reply.usage.outputTokens)} out`);
  else unavailable.push("Output tokens unavailable");
  const cost = typeof reply?.costCents === "string" && reply.costCents.trim() !== "" ? Number(reply.costCents) : reply?.costCents;
  if (reply?.local === true) parts.push("FREE (Local)");
  else if (measured(cost)) parts.push(`$${(cost / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`);
  else unavailable.push("This vendor did not report a price.");
  if (reply?.fallbackUsed) parts.push("answered by a backup model");
  parts.push("Not fact-checked");
  const documents = metadata?.documents;
  return <>
    <div className="mt-1 text-(length:--text-nano) text-muted-foreground" title={unavailable.join(" · ")}>{parts.join(" · ")}{memory ? <> · <CouncilMemoryButton {...memory} /></> : null}</div>
    {documents?.length ? <div className="text-(length:--text-nano) text-muted-foreground" title={documents.join(", ")}>Read: {documents.slice(0, 3).join(", ")}{documents.length > 3 ? ` +${documents.length - 3} more` : null}</div> : null}
  </>;
}
