import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatTokens, replyFooterParts } from "./council-reply-labels";

describe("council reply labels", () => {
  it("formats duration and tokens", () => {
    expect(formatDuration(3200)).toBe("3.2 s");
    expect(formatDuration(64000)).toBe("1 m 04 s");
    expect(formatTokens(1200)).toBe("1.2k");
  });
  it("labels local replies free", () => expect(formatCost({ local: true })).toBe("FREE (Local)"));
  it("converts cloud cents to dollars including zero", () => {
    expect(formatCost({ costCents: "1.23" })).toBe("$0.0123");
    expect(formatCost({ costCents: "0" })).toBe("$0.00");
  });
  it("reports missing and unknown costs", () => {
    expect(formatCost({})).toBe("cost unavailable");
    expect(formatCost({ costCents: "1", costStatus: "estimated-missing" })).toBe("cost unavailable");
  });
  it("marks estimates", () => expect(formatCost({ costCents: "1.23", costStatus: "estimated" })).toBe("$0.0123 estimated"));
  it("does not invent missing numbers", () => {
    expect(replyFooterParts(undefined).map((part) => part.value)).toEqual(["unavailable", "unavailable in / unavailable out", "cost unavailable", "Not fact-checked"]);
  });
});
