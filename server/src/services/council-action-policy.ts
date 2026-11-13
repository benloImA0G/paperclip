export type CouncilActionTier = 0 | 1 | 2 | 3;
export type CouncilActionDecision = "run" | "run_notify" | "needs_approval" | "blocked";
export type CouncilActionDataClass = "public" | "internal" | "restricted";

export type CouncilAction = {
  kind: string;
  external?: boolean;
  reversible?: boolean;
  estimatedCostCents?: number;
  dataClass?: CouncilActionDataClass;
  targetsCloud?: boolean;
};

export type CouncilActionClassification = {
  tier: CouncilActionTier;
  decision: CouncilActionDecision;
  reason: string;
};

// Any estimated cost above this many cents needs approval. 0 means any paid call.
export const COUNCIL_ACTION_COST_CAP_CENTS = 0;

// Fallback for kinds that are not in the table: fail closed.
const UNKNOWN_KIND_TIER: CouncilActionTier = 2;

const DECISION_BY_TIER: Record<CouncilActionTier, CouncilActionDecision> = {
  0: "run",
  1: "run_notify",
  2: "needs_approval",
  3: "blocked",
};

export const COUNCIL_ACTION_KINDS: Record<string, { tier: CouncilActionTier; label: string }> = {
  // Tier 0: read-only and internal.
  "search": { tier: 0, label: "Search room and company content" },
  "summarize": { tier: 0, label: "Summarize a discussion" },
  "read_document": { tier: 0, label: "Read a document" },
  // Tier 1: reversible internal writes.
  "create_draft_task": { tier: 1, label: "Create a draft task" },
  "save_artifact_version": { tier: 1, label: "Save a new artifact version" },
  "add_room_comment": { tier: 1, label: "Add a room comment" },
  "export_file": { tier: 1, label: "Export a file for download" },
  // Tier 2: external, costly or hard to reverse.
  "send_message_external": { tier: 2, label: "Send an email or message outside the company" },
  "publish": { tier: 2, label: "Publish content" },
  "spend_above_cap": { tier: 2, label: "Spend above the cost cap" },
  "delete": { tier: 2, label: "Delete something" },
  "assign_agent_task": { tier: 2, label: "Assign work to an agent that runs tools" },
  "call_paid_model": { tier: 2, label: "Call a paid model" },
  // Tier 3: never allowed.
  "change_permissions": { tier: 3, label: "Change permissions" },
  "change_budget": { tier: 3, label: "Change budgets" },
  "edit_policy": { tier: 3, label: "Edit this policy, the evals or the audit log" },
  "access_secrets": { tier: 3, label: "Read or write secrets" },
  "disable_logging": { tier: 3, label: "Turn off logging" },
};

const TIER_REASONS: Record<CouncilActionTier, string> = {
  0: "Read-only and internal, so it runs and is only logged.",
  1: "Internal and reversible, so it runs, you are told, and you can undo it.",
  2: "External, costly or hard to undo, so it waits for your approval.",
  3: "This is never allowed and cannot be approved.",
};

export function listCouncilActionKinds() {
  return Object.entries(COUNCIL_ACTION_KINDS).map(([kind, info]) => ({
    kind,
    tier: info.tier,
    decision: DECISION_BY_TIER[info.tier],
    label: info.label,
  }));
}

function result(tier: CouncilActionTier, reason: string): CouncilActionClassification {
  return { tier, decision: DECISION_BY_TIER[tier], reason };
}

export function classifyCouncilAction(action: CouncilAction): CouncilActionClassification {
  const known = Object.prototype.hasOwnProperty.call(COUNCIL_ACTION_KINDS, action.kind)
    ? COUNCIL_ACTION_KINDS[action.kind]
    : null;
  let tier: CouncilActionTier = known ? known.tier : UNKNOWN_KIND_TIER;
  let reason = known ? TIER_REASONS[tier] : "Unknown action type, so it waits for your approval to be safe.";

  // Modifiers can only raise a tier, never lower it.
  const raise = (to: CouncilActionTier, why: string) => {
    if (to > tier) {
      tier = to;
      reason = why;
    }
  };

  if (action.external === true) raise(2, "It reaches outside the company, so it waits for your approval.");
  if (action.reversible === false) raise(2, "It cannot be undone, so it waits for your approval.");
  if ((action.estimatedCostCents ?? 0) > COUNCIL_ACTION_COST_CAP_CENTS) {
    raise(2, "It costs money, so it waits for your approval.");
  }
  if (action.dataClass === "restricted" && action.targetsCloud === true) {
    raise(3, "Restricted data must never be sent to a cloud provider.");
  }

  return result(tier, reason);
}
