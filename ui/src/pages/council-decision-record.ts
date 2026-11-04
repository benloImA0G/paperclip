export type CouncilDecisionRecord = {
  recommendation: string;
  confidence: string;
  agreement: string[];
  dissent: string[];
  risks: string[];
  nextQuestion: string;
};

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
  const nextQuestion = section(markdown, "Next question", "__end__");
  const confidence = markdown.match(/^\*\*Confidence:\*\*\s*(High|Medium|Low)\b([^\n]*)/im);
  if (!recommendation || !agreementText || !dissentText || !risksText || !nextQuestion || !confidence) return null;
  return { recommendation: withoutConfidence(recommendation), confidence: `${confidence[1]}${confidence[2]}`.trim(), agreement: bullets(agreementText), dissent: dissentText.toLowerCase() === "none" ? [] : bullets(dissentText), risks: bullets(risksText), nextQuestion };
}
