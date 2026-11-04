import { describe, expect, it } from "vitest";
import { parseCouncilDecisionRecord } from "./council-decision-record";

describe("parseCouncilDecisionRecord", () => {
  it("parses the decision format and None dissent", () => {
    expect(parseCouncilDecisionRecord("### Recommendation\nChoose A.\n\n**Confidence:** High — all seats said so\n\n### Where seats agree\n- Ship it\n\n### Disagreement / dissent\nNone\n\n### Risks and unknowns\n- Timing\n\n### Next question\nCan we ship?")?.dissent).toEqual([]);
  });
  it("returns null for ordinary markdown", () => {
    expect(parseCouncilDecisionRecord("### Recommendation\nOnly this section")).toBeNull();
  });
});
