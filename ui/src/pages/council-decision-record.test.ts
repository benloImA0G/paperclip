import { describe, expect, it } from "vitest";
import { parseCouncilDecisionRecord } from "./council-decision-record";

describe("parseCouncilDecisionRecord", () => {
  it("parses the decision format and None dissent", () => {
    const decision = parseCouncilDecisionRecord("### Recommendation\nChoose A.\n\n**Confidence:** High — all seats said so\n\n### Where seats agree\n- Ship it\n\n### Disagreement / dissent\nNone\n\n### Risks and unknowns\n- Timing\n\n### Next question\nCan we ship?");
    expect(decision?.dissent).toEqual([]);
    expect(decision?.recommendation).toBe("Choose A.");
    expect(decision?.confidence).toBe("High — all seats said so");
  });
  it("returns null for ordinary markdown", () => {
    expect(parseCouncilDecisionRecord("### Recommendation\nOnly this section")).toBeNull();
  });
});
