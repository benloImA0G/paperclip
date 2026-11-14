import { describe, expect, it } from "vitest";
import { buildMinorityView } from "../services/council-minority.js";

const ok = (seatName: string, text: string, extra: object = {}) => ({ seatName, status: "ok", text, ...extra });

describe("buildMinorityView", () => {
  it("returns no minority when everyone agrees", () => {
    const view = buildMinorityView({ results: [ok("A", "yes", { stance: { stance: "agree", confidence: 4 } }), ok("Chair", "Summary", { orchestrator: true })] });
    expect(view).toMatchObject({ hasMinority: false, items: [] });
  });

  it("flags a low-ranked disagreeing seat and an uncovered point", () => {
    const view = buildMinorityView({
      results: [
        ok("A", "ship it", { stance: { stance: "agree", confidence: 5 } }),
        ok("B", "x", { stance: { stance: "disagree", confidence: 4, objection: "The database migration lacks rollback safety" } }),
        ok("Chair", "Ship it now.", { orchestrator: true }),
      ],
      ranking: { order: [{ seatName: "A" }, { seatName: "B" }] },
    });
    expect(view.items).toEqual([{ seat: "B", view: "The database migration lacks rollback safety", reason: "ranked_low_but_disagrees" }]);
    expect(view.summaryCoverage.uncovered).toEqual(["B"]);
  });

  it("marks covered points, dissent and conditional objections, truncates", () => {
    const view = buildMinorityView({
      results: [
        ok("C", "ok", { stance: { stance: "agree_with_conditions", confidence: 3, objection: `rollback plan missing ${"z".repeat(400)}` } }),
        ok("Chair", "We need a rollback plan first.", { orchestrator: true }),
      ],
      dissent: { strength: "strong", argument: "Rollback plan is absent entirely" },
    });
    expect(view.items.map((i) => i.reason)).toEqual(["different_conclusion", "dissent_flagged"]);
    expect(view.items[0]!.view.length).toBeLessThanOrEqual(240);
    expect(view.summaryCoverage.covered).toContain("Devil's advocate");
  });
});
