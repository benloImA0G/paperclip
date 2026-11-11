import type { CouncilKind, CouncilSeatRole } from "../api/council";

export type CouncilTemplateId = "quick-check" | "balanced-debate" | "decision" | "red-team" | "blind-best-of-n" | "debate-to-agreement" | "fresh-angles" | "get-it-done" | "review-document" | "builder-reviewer" | "research-build-review";

export type CouncilTemplate = {
  id: CouncilTemplateId;
  kind: CouncilKind;
  name: string;
  whatHappens: string;
  title: string;
  discussion: boolean;
  depth: "low" | "medium" | "high" | "agree";
  autoSummary: boolean;
  requireApproval: boolean;
  orchestrator: string | null;
  roles: Record<string, CouncilSeatRole>;
  rounds: number;
  peerRanking?: boolean;
  jury?: boolean;
  panelSize?: number;
  workMode?: "none" | "plan-first";
  askFirst?: boolean;
  juryChecks?: boolean;
  draftTasks?: boolean;
  answerStyle?: "side-by-side" | "chain";
  prompt?: string;
};

export const COUNCIL_TEMPLATES: readonly CouncilTemplate[] = [
  { id: "quick-check", kind: "quick-fact", name: "Quick check", whatHappens: "Everyone answers, then one fast round of discussion. A Chairman seat, if you have one, adds a short recommendation.", title: "Quick check", discussion: true, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: {}, rounds: 1 },
  { id: "balanced-debate", kind: "brainstorm", name: "Balanced debate", whatHappens: "Everyone answers, then weighs trade-offs together.", title: "Balanced debate", discussion: true, depth: "medium", autoSummary: false, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator" }, rounds: 3 },
  { id: "decision", kind: "decision", name: "Decision", whatHappens: "The room debates and publishes a decision record for export.", title: "Decision", discussion: true, depth: "medium", autoSummary: true, requireApproval: true, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "researcher" }, rounds: 3 },
  { id: "red-team", kind: "review", name: "Red-team", whatHappens: "Critics challenge the idea while research fills the gaps.", title: "Red-team", discussion: true, depth: "high", autoSummary: true, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "critic", Friendly: "researcher" }, rounds: 4 },
  { id: "blind-best-of-n", kind: "brainstorm", name: "Blind best-of-N", whatHappens: "Four seats answer, rank each other anonymously, and a jury votes on the winner before a summary.", title: "Blind best-of-N", discussion: false, depth: "low", autoSummary: true, requireApproval: false, orchestrator: null, roles: {}, rounds: 1, panelSize: 4, peerRanking: true, jury: true },
  { id: "debate-to-agreement", kind: "decision", name: "Debate to agreement", whatHappens: "The seats debate toward agreement, with a dissent check when they agree too quickly.", title: "Debate to agreement", discussion: true, depth: "agree", autoSummary: false, requireApproval: false, orchestrator: null, roles: {}, rounds: 4 },
  { id: "fresh-angles", kind: "brainstorm", name: "Fresh angles", whatHappens: "Three seats with different perspectives answer once and produce a summary.", title: "Fresh angles", discussion: false, depth: "low", autoSummary: true, requireApproval: false, orchestrator: null, roles: {}, rounds: 1, panelSize: 3 },
  { id: "get-it-done", kind: "plan-and-do", name: "Get it done", whatHappens: "The chair can ask questions, plan the work, have a jury check each step, and draft tasks for approval.", title: "Get it done", discussion: false, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: {}, rounds: 1, workMode: "plan-first", askFirst: true, juryChecks: true, draftTasks: true },
  { id: "review-document", kind: "review", name: "Review a document", whatHappens: "Every seat critiques the attached document: gaps, risks, contradictions, with citations", title: "Review a document", discussion: false, depth: "low", autoSummary: true, requireApproval: false, orchestrator: null, roles: {}, rounds: 1, peerRanking: false, prompt: "Review the attached document. List the biggest gaps, risks and contradictions, cite the source marker (like [d1#2]) for each, and suggest one concrete fix per point." },
  { id: "builder-reviewer", kind: "review", name: "Builder then reviewer (chain)", whatHappens: "A builder drafts an answer, then a critic reviews it.", title: "Builder then reviewer", discussion: false, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: { Creative: "builder", Techie: "critic" }, rounds: 1, answerStyle: "chain" },
  { id: "research-build-review", kind: "plan-and-do", name: "Research, build, review", whatHappens: "A researcher gathers facts, a builder drafts an answer, and a reviewer checks it.", title: "Research, build, review", discussion: false, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: { Creative: "researcher", Techie: "builder", CodeBot: "critic" }, rounds: 1, answerStyle: "chain" },
];

export const DEFAULT_COUNCIL_TEMPLATE_ID: CouncilTemplateId = "quick-check";

export function councilCallEstimate(template: CouncilTemplate, seatCount: number): number {
  return Math.max(0, seatCount) * template.rounds + (template.orchestrator ? 1 : 0);
}

/** Presets for the two chain templates, keyed by their assigned role. */
export const CHAIN_TEMPLATE_PRESETS = { researcher: "researcher", builder: "builder", critic: "reviewer" } as const;
export const GENERIC_TEMPLATE_SEAT_NAMES = ["CodeBot", "Creative", "Techie", "Friendly"] as const;
