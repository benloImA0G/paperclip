import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CouncilMinorityView } from "./CouncilMinorityView";

describe("CouncilMinorityView", () => {
  it("renders nothing without items", () => {
    expect(renderToStaticMarkup(<CouncilMinorityView items={[]} />)).toBe("");
  });

  it("renders a collapsed block with reason and uncovered flag", () => {
    const html = renderToStaticMarkup(
      <CouncilMinorityView items={[{ seat: "B", view: "No rollback", reason: "dissent_flagged" }]} uncovered={["B"]} />,
    );
    expect(html).toContain("Minority view (1)");
    expect(html).toContain("Dissent flagged");
    expect(html).toContain("Not in the summary");
    expect(html).not.toContain("<details open");
  });
});
