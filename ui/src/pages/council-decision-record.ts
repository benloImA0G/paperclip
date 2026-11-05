export type CouncilDecisionRecord = {
  recommendation: string;
  confidence: string;
  agreement: string[];
  dissent: string[];
  risks: string[];
  nextQuestion: string;
  actionItems: CouncilActionItem[];
};

export type CouncilActionItem = { text: string; owner?: string };

export function parseActionItems(value: string | null): CouncilActionItem[] {
  if (!value || value.trim().toLowerCase() === "none") return [];
  const items: CouncilActionItem[] = [];
  for (const line of value.split("\n")) {
    const body = line.replace(/^\s*[-*+]\s+/, "").trim();
    if (!body || body.toLowerCase() === "none") continue;
    const match = body.match(/^\[\s*(?:suggested owner:\s*)?([^\]]+?)\s*\]\s*(.+)$/i);
    const owner = match?.[1]?.trim();
    const text = (match ? match[2] : body).trim();
    if (!text) continue;
    items.push(owner && owner.toLowerCase() !== "unassigned" ? { text, owner } : { text });
  }
  return items.slice(0, 5);
}

function section(text: string, heading: string, next: string): string | null {
  const start = text.search(new RegExp(`^### ${heading}\\s*$`, "im"));
  if (start < 0) return null;
  const bodyStart = text.indexOf("\n", start) + 1;
  const end = text.search(new RegExp(`^### ${next}\\s*$`, "im"));
  return text.slice(bodyStart, end >= bodyStart ? end : text.length).trim() || null;
}

function bullets(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/^\s*[-*+]\s+/, "").trim()).filter(Boolean);
}

function withoutConfidence(text: string): string {
  return text.replace(/^\*\*Confidence:\*\*\s*(?:High|Medium|Low)\b[^\n]*(?:\n|$)/im, "").trim();
}

export function parseCouncilDecisionRecord(markdown: string): CouncilDecisionRecord | null {
  const recommendation = section(markdown, "Recommendation", "Where seats agree");
  const agreementText = section(markdown, "Where seats agree", "Disagreement / dissent");
  const dissentText = section(markdown, "Disagreement / dissent", "Risks and unknowns");
  const risksText = section(markdown, "Risks and unknowns", "Next question");
  const nextQuestion = section(markdown, "Next question", "Action items");
  const actionItems = parseActionItems(section(markdown, "Action items", "__end__"));
  const confidence = markdown.match(/^\*\*Confidence:\*\*\s*(High|Medium|Low)\b([^\n]*)/im);
  if (!recommendation || !agreementText || !dissentText || !risksText || !nextQuestion || !confidence) return null;
  return { recommendation: withoutConfidence(recommendation), confidence: `${confidence[1]}${confidence[2]}`.trim(), agreement: bullets(agreementText), dissent: dissentText.toLowerCase() === "none" ? [] : bullets(dissentText), risks: bullets(risksText), nextQuestion, actionItems };
}
