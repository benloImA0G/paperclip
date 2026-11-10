import { describe, expect, it } from "vitest";
import { COUNCIL_ROLE_PRESETS } from "./council-role-presets";

describe("council role presets", () => {
  it("has unique ids, valid roles, and concise personas", () => {
    expect(COUNCIL_ROLE_PRESETS).toHaveLength(12);
    expect(new Set(COUNCIL_ROLE_PRESETS.map((preset) => preset.id)).size).toBe(COUNCIL_ROLE_PRESETS.length);
    for (const preset of COUNCIL_ROLE_PRESETS) {
      expect(["none", "researcher", "builder", "critic", "synthesizer", "moderator"]).toContain(preset.role);
      expect(preset.persona.match(/[^.!?]+[.!?]+/g)?.length).toBeGreaterThanOrEqual(3);
      expect(preset.persona.match(/[^.!?]+[.!?]+/g)?.length).toBeLessThanOrEqual(5);
      expect(preset.persona.endsWith("Keep answers short and specific.")).toBe(true);
    }
  });
});
