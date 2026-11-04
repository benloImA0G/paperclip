import { describe, expect, it } from "vitest";
import { COUNCIL_TEMPLATES, councilCallEstimate } from "./council-templates";

describe("council room templates", () => {
  it("estimates seat rounds plus one orchestrator call", () => {
    expect(councilCallEstimate(COUNCIL_TEMPLATES[0], 4)).toBe(4);
    expect(councilCallEstimate(COUNCIL_TEMPLATES[1], 4)).toBe(13);
    expect(councilCallEstimate(COUNCIL_TEMPLATES[3], 4)).toBe(17);
  });

  it("keeps balanced debate as the default and decision roles explicit", () => {
    expect(COUNCIL_TEMPLATES[1].id).toBe("balanced-debate");
    expect(COUNCIL_TEMPLATES[2].roles).toMatchObject({ Techie: "critic", CodeBot: "researcher" });
  });
});
