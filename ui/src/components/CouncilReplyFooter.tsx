import { CouncilMemoryButton, type CouncilMemoryButtonProps } from "./CouncilMemoryButton";
import { formatTokens, type CouncilReplyReliability } from "../pages/council-reply-labels";

/** Replace known source markers for display only; the original reply remains unchanged. */
export function displayCouncilCitations(text: string, documents: readonly string[] = []): string {
  const replaceProse = (prose: string) => prose.replace(/\[d(\d+)#(\d+)\]/g, (marker, index: string) => {
    const name = documents[Number(index) - 1];
    return name ? `\`${name.replace(/`/g, "'")}\`` : marker;
  });
  // Preserve fenced blocks and matched inline code spans before replacing prose.
  return text.split(/(^[ \t]{0,3}`{3,}[^\n]*\n[\s\S]*?^[ \t]{0,3}`{3,}[^\n]*(?:\n|$)|^[ \t]{0,3}`{3,}[^\n]*(?:\n[\s\S]*)?$)/gm)
    .map((part, index) => index % 2 ? part : part.replace(/(`+)([\s\S]*?)\1|\[d\d+#\d+\]/g, (match, ticks: string | undefined) => ticks ? match : replaceProse(match)))
    .join("");
}

type Reliability = Omit<CouncilReplyReliability, "costCents"> & { costCents?: number | string; documents?: string[] };
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

type Evaluation = {
  jury?: { unavailable?: boolean; answerSeat?: string; verdict?: string; judges?: number; eligible?: number; counts?: Record<string, number> };
  ranking?: { unavailable?: boolean; judges?: number; eligible?: number; order?: Array<{ seatName: string }> };
};

export function CouncilReplyFooter({ metadata, memory }: { metadata?: { councilReliability?: Reliability | null; documents?: string[]; sections?: Array<{ title?: string | null; rows: Array<{ type: string; text?: string }> }> } | null; memory?: CouncilMemoryButtonProps }) {
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
  const documents = metadata?.councilReliability?.documents ?? metadata?.documents;
  const evaluationText = metadata?.sections?.find((section) => section.title === "Council evaluation")?.rows.find((row) => row.type === "text")?.text;
  let evaluation: Evaluation | undefined;
  try { if (evaluationText) evaluation = JSON.parse(evaluationText) as Evaluation; } catch { /* Older or malformed metadata has no evaluation. */ }
  return <>
    {evaluation?.jury ? <div className="mt-2 break-words rounded-md border p-2 text-xs"><strong>Jury:</strong> {evaluation.jury.unavailable ? "Unavailable" : <>{evaluation.jury.verdict?.toUpperCase()} on {evaluation.jury.answerSeat} ({evaluation.jury.judges}/{evaluation.jury.eligible} judges); pass {evaluation.jury.counts?.pass}, revise {evaluation.jury.counts?.revise}, fail {evaluation.jury.counts?.fail}</>}</div> : null}
    {evaluation?.ranking ? <div className="mt-2 break-words rounded-md border p-2 text-xs"><strong>Blind peer ranking:</strong> {evaluation.ranking.unavailable ? "Unavailable" : <>{evaluation.ranking.order?.map((row, i) => `${i + 1}. ${row.seatName}`).join(", ")} ({evaluation.ranking.judges}/{evaluation.ranking.eligible} judges)</>}</div> : null}
    <div className="mt-1 text-(length:--text-nano) text-muted-foreground" title={unavailable.join(" · ")}>{parts.join(" · ")}{memory ? <> · <CouncilMemoryButton {...memory} /></> : null}</div>
    {documents?.length ? <div className="text-(length:--text-nano) text-muted-foreground" title={documents.join(", ")}>Read: {documents.slice(0, 3).join(", ")}{documents.length > 3 ? ` +${documents.length - 3} more` : null}</div> : null}
  </>;
}
