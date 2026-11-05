import { describe, expect, it } from "vitest";
import { parseCouncilDecisionRecord } from "./council-decision-record";

describe("parseCouncilDecisionRecord", () => {
  it("parses the decision format and None dissent", () => {
    const decision = parseCouncilDecisionRecord("### Recommendation\nChoose A.\n\n**Confidence:** High — all seats said so\n\n### Where seats agree\n- Ship it\n\n### Disagreement / dissent\nNone\n\n### Risks and unknowns\n- Timing\n\n### Next question\nCan we ship?");
    expect(decision?.dissent).toEqual([]);
    expect(decision?.recommendation).toBe("Choose A.");
    expect(decision?.confidence).toBe("High — all seats said so");
  });
  it("parses action items with owners and tolerates old cards", () => {
    const base = "### Recommendation\nChoose A.\n\n**Confidence:** High\n\n### Where seats agree\n- x\n\n### Disagreement / dissent\nNone\n\n### Risks and unknowns\n- y\n\n### Next question\nQ?";
    expect(parseCouncilDecisionRecord(base)?.actionItems).toEqual([]);
    const withItems = parseCouncilDecisionRecord(`${base}\n\n### Action items\n- [Suggested owner: Ben] Sign the contract\n- Draft the memo\n- [Unassigned] Review`);
    expect(withItems?.nextQuestion).toBe("Q?");
    expect(withItems?.actionItems).toEqual([{ text: "Sign the contract", owner: "Ben" }, { text: "Draft the memo" }, { text: "Review" }]);
    expect(parseCouncilDecisionRecord(`${base}\n\n### Action items\nNone`)?.actionItems).toEqual([]);
  });
  it("returns null for ordinary markdown", () => {
    expect(parseCouncilDecisionRecord("### Recommendation\nOnly this section")).toBeNull();
  });
});
