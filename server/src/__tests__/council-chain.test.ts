import { describe, expect, it } from "vitest";
import { CHAIN_HANDOFF_CHARS, capChainHandoff } from "../services/council-chat.js";

describe("council chain handoff cap", () => {
  it("keeps short chains whole and in order", () => {
    const out = capChainHandoff([{ name: "Builder", text: "draft" }, { name: "Critic", text: "fixes" }]);
    expect(out).toEqual([{ name: "Builder", text: "draft" }, { name: "Critic", text: "fixes" }]);
  });

  it("trims the oldest answer first and keeps the newest whole", () => {
    const big = "x".repeat(CHAIN_HANDOFF_CHARS);
    const out = capChainHandoff([{ name: "A", text: big }, { name: "B", text: "latest answer" }]);
    expect(out[out.length - 1]).toEqual({ name: "B", text: "latest answer" });
    expect(out.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(CHAIN_HANDOFF_CHARS);
    expect(out[0]?.text).toContain("[trimmed]");
  });

  it("returns nothing for no answers", () => {
    expect(capChainHandoff([])).toEqual([]);
  });
});
