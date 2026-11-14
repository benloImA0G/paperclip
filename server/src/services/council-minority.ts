import { redactSensitiveText } from "../redaction.js";
import type { AgreementScore, ParsedStance } from "./council-consensus.js";
import type { DissentResult } from "./council-dissent.js";

/**
 * Chair safeguard: collect the views that disagree with the majority so they can be shown next to the
 * orchestrator's summary. Pure: built only from data a round already returns (no model calls).
 */
export const MINORITY_VIEW_LENGTH = 240;

export type MinorityReason = "ranked_low_but_disagrees" | "dissent_flagged" | "different_conclusion";
export type MinorityItem = { seat: string; view: string; reason: MinorityReason };

export type MinorityRoundInput = {
  results: Array<{ seatName: string; status: string; text?: string; orchestrator?: boolean; stance?: ParsedStance }>;
  agreement?: Pick<AgreementScore, "objections">;
  dissent?: DissentResult;
  ranking?: { order: Array<{ seatName: string }> } | { unavailable: true };
};

export type MinorityView = {
  hasMinority: boolean;
  items: MinorityItem[];
  summaryCoverage: { summaryPresent: boolean; covered: string[]; uncovered: string[] };
};

const STOP = new Set(["that", "this", "with", "from", "have", "will", "would", "should", "could", "there", "their", "about", "which", "while", "than", "then", "they", "been", "were", "also", "into", "only", "more", "most", "does", "your"]);

function excerpt(body: string): string {
  const plain = redactSensitiveText(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MINORITY_VIEW_LENGTH ? `${plain.slice(0, MINORITY_VIEW_LENGTH - 1).trimEnd()}…` : plain;
}

function keywords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !STOP.has(word)));
}

export function buildMinorityView(round: MinorityRoundInput): MinorityView {
  const seats = round.results.filter((r) => r.status === "ok" && r.text && !r.orchestrator);
  const summary = round.results.find((r) => r.orchestrator && r.status === "ok" && r.text)?.text ?? "";
  const order = round.ranking && "order" in round.ranking ? round.ranking.order.map((o) => o.seatName) : [];
  const lowRanked = new Set(order.slice(Math.ceil(order.length / 2)));
  const objections = new Map((round.agreement?.objections ?? []).map((o) => [o.seat, o.text]));

  const items: MinorityItem[] = [];
  for (const seat of seats) {
    const stance = seat.stance?.stance;
    const objection = seat.stance?.objection ?? objections.get(seat.seatName);
    const body = objection || seat.text!;
    let reason: MinorityReason | null = null;
    if (stance === "disagree") reason = lowRanked.has(seat.seatName) ? "ranked_low_but_disagrees" : "dissent_flagged";
    else if (stance === "agree_with_conditions" && objection) reason = "different_conclusion";
    const view = reason ? excerpt(body) : "";
    if (reason && view) items.push({ seat: seat.seatName, view, reason });
  }
  if (round.dissent && round.dissent.strength !== "none" && round.dissent.argument.trim()) {
    const view = excerpt(round.dissent.argument);
    if (view) items.push({ seat: "Devil's advocate", view, reason: "dissent_flagged" });
  }

  const summaryWords = keywords(summary);
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const item of items) {
    const words = [...keywords(item.view)];
    const hits = words.filter((w) => summaryWords.has(w)).length;
    (words.length > 0 && hits / words.length >= 0.3 ? covered : uncovered).push(item.seat);
  }
  return { hasMinority: items.length > 0, items, summaryCoverage: { summaryPresent: Boolean(summary), covered, uncovered } };
}
