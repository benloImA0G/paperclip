import { describe, expect, it } from "vitest";
import { buildDissentPrompt, describeDissent, parseDissent, shouldRunDissent } from "../services/council-dissent.js";
import type { AgreementScore } from "../services/council-consensus.js";

const score = (over: Partial<AgreementScore> = {}): AgreementScore => ({
  percent: 90, label: "Strong agreement", plain: "", concessions: [], objections: [],
  counts: { agree: 3, conditions: 0, disagree: 0, abstain: 0 }, reached: true, ...over,
});

describe("shouldRunDissent", () => {
  it("runs when agreement is fast and unanimous", () => {
    expect(shouldRunDissent(score(), { roundsRun: 1, maxRounds: 3 })).toBe(true);
  });
  it("skips when not reached, anyone disagrees, or too few voices", () => {
    expect(shouldRunDissent(score({ reached: false }), { roundsRun: 1, maxRounds: 3 })).toBe(false);
    expect(shouldRunDissent(score({ counts: { agree: 3, conditions: 0, disagree: 1, abstain: 0 } }), { roundsRun: 1, maxRounds: 3 })).toBe(false);
    expect(shouldRunDissent(score({ counts: { agree: 2, conditions: 0, disagree: 0, abstain: 0 } }), { roundsRun: 1, maxRounds: 3 })).toBe(false);
  });
  it("skips low percent and slow agreement", () => {
    expect(shouldRunDissent(score({ percent: 70 }), { roundsRun: 1, maxRounds: 3 })).toBe(false);
    expect(shouldRunDissent(score(), { roundsRun: 3, maxRounds: 3 })).toBe(false);
  });
});

describe("dissent prompt and parsing", () => {
  it("wraps inputs as untrusted", () => {
    const p = buildDissentPrompt({ question: "Use X?", position: "Yes use X" });
    expect(p).toContain("BEGIN UNTRUSTED QUESTION");
    expect(p).toContain("BEGIN UNTRUSTED AGREED POSITION");
  });
  it("parses strength and argument, tolerating bold", () => {
    expect(parseDissent("**DISSENT: STRONG**\nARGUMENT: It ignores cost.")).toEqual({ strength: "strong", argument: "It ignores cost." });
    expect(parseDissent("DISSENT: none")?.strength).toBe("none");
    expect(parseDissent("whatever")).toBeNull();
  });
  it("describes each outcome", () => {
    expect(describeDissent({ strength: "strong", argument: "a" })).toContain("serious");
    expect(describeDissent({ strength: "weak", argument: "a" })).toContain("minor");
    expect(describeDissent({ strength: "none", argument: "" })).toContain("no real objection");
  });
});
