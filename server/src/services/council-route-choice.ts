export type CouncilRoute = "single" | "council";

export interface ChooseRouteInput {
  question: string;
  attachmentCount?: number;
  mode?: string;
}

export interface ChooseRouteResult {
  route: CouncilRoute;
  reason: string;
}

const COUNCIL_WORDS = [
  "should", "decide", "decision", "trade-off", "tradeoff", "trade off", "compare", "comparison",
  "versus", "vs", "pros and cons", "risk", "plan", "strategy", "strategic", "security", "secure",
  "invest", "budget", "money", "cost", "pricing", "price", "revenue", "profit", "legal", "which is better",
  "sebaiknya", "pilih mana", "bandingkan", "perbandingan", "keputusan", "strategi", "rencana",
  "risiko", "keamanan", "uang", "biaya", "investasi", "anggaran", "lebih baik",
];

const WORD_LIMIT = 25;

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function chooseRoute(input: ChooseRouteInput): ChooseRouteResult {
  const question = (input.question ?? "").trim();
  const lower = question.toLowerCase();

  if ((input.mode ?? "").toLowerCase() === "council") {
    return { route: "council", reason: "You asked for the council, so several models will discuss this." };
  }
  if ((input.attachmentCount ?? 0) > 0) {
    return { route: "council", reason: "This question has attachments, so the council will look at it more carefully." };
  }
  if (countWords(question) > WORD_LIMIT) {
    return { route: "council", reason: "This is a long question, so the council will handle it." };
  }
  if ((question.match(/\?/g) ?? []).length > 1) {
    return { route: "council", reason: "This has several questions in one, so the council will handle it." };
  }
  const hit = COUNCIL_WORDS.find((w) =>
    new RegExp("(^|[^a-z])" + w.replace(/[- ]/g, "[- ]") + "([^a-z]|$)").test(lower),
  );
  if (hit) {
    return {
      route: "council",
      reason: "This looks like a decision or trade-off, so the council will weigh the options.",
    };
  }
  return { route: "single", reason: "This is a short, simple question, so one model can answer it quickly." };
}
