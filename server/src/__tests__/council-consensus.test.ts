import { describe, expect, it } from "vitest";

import { AGREEMENT_THRESHOLD, parseStance, scoreAgreement, shouldStop, stripStanceBlock } from "../services/council-consensus.js";

describe("council consensus", () => {
  it("parses markdown-tolerant stance blocks and strips them", () => {
    const reply = "I can support this.\n\n**STANCE:** **agree with conditions**\n**CONFIDENCE:** 5\n**CONCESSION:** Ship without the optional export.\n**OBJECTION:** Keep a rollback plan.";
    expect(parseStance(reply)).toEqual({ stance: "agree_with_conditions", confidence: 5, concession: "Ship without the optional export.", objection: "Keep a rollback plan." });
    expect(stripStanceBlock(reply)).toBe("I can support this.");
  });

  it("defaults invalid or missing confidence and chooses the last stance block", () => {
    const reply = "STANCE: disagree\nCONFIDENCE: 1\n\nSTANCE: agree\nCONFIDENCE: six";
    expect(parseStance(reply)).toEqual({ stance: "agree", confidence: 3 });
    expect(parseStance("Useful response without a declaration.")).toBeNull();
  });

  it("truncates supporting text and preserves non-trailing stance-like content", () => {
    const long = "x".repeat(201);
    expect(parseStance(`STANCE: abstain\nCONCESSION: ${long}`)?.concession).toHaveLength(200);
    expect(stripStanceBlock("STANCE: agree\nThis is still prose.")).toBe("STANCE: agree\nThis is still prose.");
  });

  it("scores weighted agreement, concessions, objections, and abstentions", () => {
    const result = scoreAgreement([
      { seat: "A", stance: "agree", confidence: 5, concession: "Move the deadline." },
      { seat: "B", stance: "agree_with_conditions", confidence: 5 },
      { seat: "C", stance: "disagree", confidence: 5, objection: "Cost is too high." },
      { seat: "D", stance: "abstain", confidence: 1 },
    ]);
    expect(result).toMatchObject({ percent: 55, label: "Split", reached: false, counts: { agree: 1, conditions: 1, disagree: 1, abstain: 1 } });
    expect(result.concessions).toEqual([{ seat: "A", text: "Move the deadline." }]);
    expect(result.objections).toEqual([{ seat: "C", text: "Cost is too high." }]);
    expect(result.plain).toBe("2 of 4 seats agree (1 with conditions); 1 disagrees; 1 abstains. Agreement 55%: Split.");
  });

  it("reports insufficient input with abstentions excluded", () => {
    const result = scoreAgreement([{ seat: "A", stance: "agree", confidence: 5 }, { seat: "B", stance: "abstain", confidence: 5 }]);
    expect(result).toMatchObject({ percent: 0, label: "Not enough input", reached: false, counts: { agree: 1, conditions: 0, disagree: 0, abstain: 1 } });
  });

  it.each([
    [84, "Agreement with concessions", [0.68, 0.68, 0.68], [0.8589473684210527, 0.8589473684210527], []],
    [85, "Strong agreement", [0.68, 0.68, 0.68], [0.765, 0.765], []],
    [65, "Agreement with concessions", [0.68, 0.68], [0.68], [0.7323076923076923]],
    [64, "Split", [0.68, 0.68], [0.68], [0.775625]],
    [40, "Split", [1], [], [0.75, 0.75]],
    [39, "No agreement", [1], [], [0.782051282051282, 0.782051282051282]],
  ] as const)("uses the label boundary at %i percent", (percent, label, agrees, conditions, disagrees) => {
    const confidenceForWeight = (weight: number) => (weight - 0.6) * 12.5;
    const result = scoreAgreement([
      ...agrees.map((weight, index) => ({ seat: `agree-${index}`, stance: "agree" as const, confidence: confidenceForWeight(weight) })),
      ...conditions.map((weight, index) => ({ seat: `condition-${index}`, stance: "agree_with_conditions" as const, confidence: confidenceForWeight(weight) })),
      ...disagrees.map((weight, index) => ({ seat: `disagree-${index}`, stance: "disagree" as const, confidence: confidenceForWeight(weight) })),
    ]);
    expect(result.percent).toBe(percent);
    expect(result.label).toBe(label);
  });

  it("stops for agreement, maximum rounds, and stalled rounds in precedence order", () => {
    expect(AGREEMENT_THRESHOLD).toBe(65);
    expect(shouldStop([64, 65], { maxRounds: 2 })).toEqual({ stop: true, reason: "agreement" });
    expect(shouldStop([60, 61], { maxRounds: 2 })).toEqual({ stop: true, reason: "max_rounds" });
    expect(shouldStop([60, 62], { maxRounds: 4 })).toEqual({ stop: true, reason: "stalled" });
    expect(shouldStop([60, 64], { maxRounds: 4 })).toEqual({ stop: false, reason: "continue" });
  });
});
