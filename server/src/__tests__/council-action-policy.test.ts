import { describe, expect, it } from "vitest";
import {
  COUNCIL_ACTION_COST_CAP_CENTS,
  COUNCIL_ACTION_KINDS,
  classifyCouncilAction,
  listCouncilActionKinds,
} from "../services/council-action-policy.js";

describe("council action policy", () => {
  it("classifies each tier", () => {
    expect(classifyCouncilAction({ kind: "search" })).toMatchObject({ tier: 0, decision: "run" });
    expect(classifyCouncilAction({ kind: "create_draft_task" })).toMatchObject({ tier: 1, decision: "run_notify" });
    expect(classifyCouncilAction({ kind: "publish" })).toMatchObject({ tier: 2, decision: "needs_approval" });
    expect(classifyCouncilAction({ kind: "access_secrets" })).toMatchObject({ tier: 3, decision: "blocked" });
  });

  it("fails closed on unknown kinds", () => {
    expect(classifyCouncilAction({ kind: "do_something_new" })).toMatchObject({ tier: 2, decision: "needs_approval" });
    expect(classifyCouncilAction({ kind: "constructor" })).toMatchObject({ tier: 2 });
  });

  it("raises on external, irreversible and paid modifiers", () => {
    expect(classifyCouncilAction({ kind: "search", external: true }).tier).toBe(2);
    expect(classifyCouncilAction({ kind: "add_room_comment", reversible: false }).tier).toBe(2);
    expect(classifyCouncilAction({ kind: "summarize", estimatedCostCents: COUNCIL_ACTION_COST_CAP_CENTS + 1 }).tier).toBe(2);
    expect(classifyCouncilAction({ kind: "summarize", estimatedCostCents: 0 }).tier).toBe(0);
    expect(classifyCouncilAction({ kind: "export_file", reversible: true, external: false }).tier).toBe(1);
  });

  it("blocks restricted data going to the cloud", () => {
    expect(classifyCouncilAction({ kind: "summarize", dataClass: "restricted", targetsCloud: true }).tier).toBe(3);
    expect(classifyCouncilAction({ kind: "summarize", dataClass: "restricted", targetsCloud: false }).tier).toBe(0);
    expect(classifyCouncilAction({ kind: "summarize", dataClass: "internal", targetsCloud: true }).tier).toBe(0);
  });

  it("never lowers a blocked kind", () => {
    const result = classifyCouncilAction({
      kind: "change_permissions",
      external: false,
      reversible: true,
      estimatedCostCents: 0,
      dataClass: "public",
      targetsCloud: false,
    });
    expect(result).toMatchObject({ tier: 3, decision: "blocked" });
  });

  it("always gives a non-empty reason and lists kinds", () => {
    const kinds = listCouncilActionKinds();
    expect(kinds.length).toBe(Object.keys(COUNCIL_ACTION_KINDS).length);
    for (const { kind, tier } of kinds) {
      const out = classifyCouncilAction({ kind });
      expect(out.tier).toBe(tier);
      expect(out.reason.length).toBeGreaterThan(0);
    }
    expect(classifyCouncilAction({ kind: "nope", external: true }).reason.length).toBeGreaterThan(0);
    expect(new Set(kinds.map((k) => k.tier))).toEqual(new Set([0, 1, 2, 3]));
  });
});
