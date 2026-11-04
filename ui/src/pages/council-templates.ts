import type { CouncilSeatRole } from "../api/council";

export type CouncilTemplateId = "quick-check" | "balanced-debate" | "decision" | "red-team";

export type CouncilTemplate = {
  id: CouncilTemplateId;
  name: string;
  whatHappens: string;
  title: string;
  discussion: boolean;
  depth: "low" | "medium" | "high";
  autoSummary: boolean;
  requireApproval: boolean;
  orchestrator: string | null;
  roles: Record<string, CouncilSeatRole>;
  rounds: number;
};

export const COUNCIL_TEMPLATES: readonly CouncilTemplate[] = [
  { id: "quick-check", name: "Quick check", whatHappens: "Everyone answers once. No debate or summary.", title: "Quick check", discussion: false, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: {}, rounds: 1 },
  { id: "balanced-debate", name: "Balanced debate", whatHappens: "Everyone answers, then weighs trade-offs together.", title: "Balanced debate", discussion: true, depth: "medium", autoSummary: false, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator" }, rounds: 3 },
  { id: "decision", name: "Decision", whatHappens: "The room debates and publishes a decision record for export.", title: "Decision", discussion: true, depth: "medium", autoSummary: true, requireApproval: true, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "researcher" }, rounds: 3 },
  { id: "red-team", name: "Red-team", whatHappens: "Critics challenge the idea while research fills the gaps.", title: "Red-team", discussion: true, depth: "high", autoSummary: true, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "critic", Friendly: "researcher" }, rounds: 4 },
];

export const DEFAULT_COUNCIL_TEMPLATE_ID: CouncilTemplateId = "balanced-debate";

export function councilCallEstimate(template: CouncilTemplate, seatCount: number): number {
  return Math.max(0, seatCount) * template.rounds + (template.orchestrator ? 1 : 0);
}
