/**
 * Mode router: classify a council question into a kind and suggest how to run it.
 * Pure heuristics (no model call, zero cost, deterministic). Ben can always override.
 */
export type CouncilKind = "quick-fact" | "decision" | "brainstorm" | "review" | "plan-and-do";

export type CouncilModeSuggestion = {
  kind: CouncilKind;
  /** Which council engine mode to start in. */
  mode: "ask" | "discuss";
  rounds: number;
  /** Suggested number of seats (1 = single answer is enough). */
  seats: { min: number; max: number };
  autoSummary: boolean;
  dissentCheck: boolean;
  peerRanking: boolean;
  workSession: boolean;
  /** Matches a template id in ui council-templates.ts where one fits. */
  template: "quick-check" | "balanced-debate" | "decision" | "red-team" | null;
  /** One plain-language line shown to the user. */
  reason: string;
};

const has = (text: string, pattern: RegExp) => pattern.test(text);

const WORK = /\b(build|implement|create|write|draft|produce|generate|set ?up|migrate|refactor|fix|deliver|ship|prepare|make me|automate|design and|buat(?:kan)?|bikin|siapkan|perbaiki)\b/;
const REVIEW = /\b(review|critique|audit|check this|red[- ]?team|poke holes|what(?: is|['’]s) wrong|stress[- ]?test|is this (safe|secure|correct|ok)|find (bugs|flaws|risks)|periksa|tinjau|cek|evaluasi|cari kelemahan|apa risikonya)\b/;
const DECISION = /\b(should (i|we)|which (one|option|is better)|vs\.?|versus|choose|pick|decide|decision|trade-?off|go\/no-go|worth it|better (option|approach)|or should|sebaiknya|pilih|memilih|mana yang|lebih baik)\b/;
const BRAINSTORM = /\b(brainstorm|ideas?|options|alternatives|ways to|how (could|can|might) (i|we)|what if|creative|name(s)? for|suggest|ide|saran|alternatif|bagaimana cara)\b/;
const FACT = /^(what|who|when|where|how (many|much|long|old)|is|are|does|do|can|apa|siapa|kapan|berapa|di mana)\b/;

export function classifyCouncilQuestion(rawText: string): CouncilModeSuggestion {
  const text = rawText.trim().toLowerCase().slice(0, 4000);
  const words = text.split(/\s+/).filter(Boolean).length;

  if (words === 0) {
    return build("quick-fact");
  }
  if (has(text, REVIEW)) {
    return build("review");
  }
  if (has(text, DECISION)) {
    return build("decision");
  }
  if (has(text, BRAINSTORM)) {
    return build("brainstorm");
  }
  if (has(text, WORK) && words >= 6) {
    return build("plan-and-do");
  }
  if (words <= 14 && (has(text, FACT) || text.endsWith("?"))) {
    return build("quick-fact");
  }
  return build("decision");
}

const REASONS: Record<CouncilKind, string> = {
  "quick-fact": "Short factual question: each seat answers once, no debate.",
  decision: "Looks like a choice between options: seats debate it and a decision record is kept.",
  brainstorm: "Looks like idea generation: many different seats, then a short synthesis.",
  review: "Looks like a review: seats challenge the work and list risks.",
  "plan-and-do": "Looks like a job to be done: the chair plans steps, seats do them, a checker grades each.",
};

function build(kind: CouncilKind): CouncilModeSuggestion {
  const reason = REASONS[kind];
  switch (kind) {
    case "quick-fact":
      return { kind, mode: "ask", rounds: 1, seats: { min: 1, max: 3 }, autoSummary: false, dissentCheck: false, peerRanking: false, workSession: false, template: "quick-check", reason };
    case "brainstorm":
      return { kind, mode: "ask", rounds: 1, seats: { min: 3, max: 6 }, autoSummary: true, dissentCheck: false, peerRanking: true, workSession: false, template: "balanced-debate", reason };
    case "review":
      return { kind, mode: "discuss", rounds: 3, seats: { min: 3, max: 5 }, autoSummary: true, dissentCheck: true, peerRanking: false, workSession: false, template: "red-team", reason };
    case "plan-and-do":
      return { kind, mode: "ask", rounds: 1, seats: { min: 2, max: 5 }, autoSummary: true, dissentCheck: false, peerRanking: false, workSession: true, template: null, reason };
    case "decision":
    default:
      return { kind: "decision", mode: "discuss", rounds: 3, seats: { min: 3, max: 5 }, autoSummary: true, dissentCheck: true, peerRanking: false, workSession: false, template: "decision", reason };
  }
}
