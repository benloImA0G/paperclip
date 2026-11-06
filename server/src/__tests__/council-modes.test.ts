import { describe, expect, it } from "vitest";
import { classifyCouncilQuestion } from "../services/council-modes.js";

describe("classifyCouncilQuestion", () => {
  it("treats empty input as a quick fact", () => {
    expect(classifyCouncilQuestion("   ").kind).toBe("quick-fact");
  });
  it("short factual question -> quick check, single round", () => {
    const s = classifyCouncilQuestion("What port does Postgres use?");
    expect(s.kind).toBe("quick-fact");
    expect(s.rounds).toBe(1);
    expect(s.template).toBe("quick-check");
    expect(s.workSession).toBe(false);
  });
  it("choice between options -> decision with dissent check", () => {
    const s = classifyCouncilQuestion("Should we use Postgres or SQLite for the council history?");
    expect(s.kind).toBe("decision");
    expect(s.mode).toBe("discuss");
    expect(s.dissentCheck).toBe(true);
  });
  it("review wins over decision wording", () => {
    expect(classifyCouncilQuestion("Please review this migration and find risks, should we merge?").kind).toBe("review");
  });
  it("brainstorm asks for many seats and ranking", () => {
    const s = classifyCouncilQuestion("Brainstorm ideas for naming the new dashboard");
    expect(s.kind).toBe("brainstorm");
    expect(s.peerRanking).toBe(true);
    expect(s.seats.min).toBeGreaterThanOrEqual(3);
  });
  it("job to be done -> plan-and-do work session", () => {
    const s = classifyCouncilQuestion("Build a landing page for the workforce OS with pricing and a signup form");
    expect(s.kind).toBe("plan-and-do");
    expect(s.workSession).toBe(true);
  });
  it("short imperative without enough detail is not a work session", () => {
    expect(classifyCouncilQuestion("fix it").workSession).toBe(false);
  });
  it("is deterministic and always gives a reason", () => {
    const a = classifyCouncilQuestion("Which framework is better for this?");
    const b = classifyCouncilQuestion("Which framework is better for this?");
    expect(a).toEqual(b);
    expect(a.reason.length).toBeGreaterThan(10);
  });
});
