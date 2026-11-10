import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CouncilRoomStats, formatCouncilMarkdown, sumCouncilReplies } from "./CouncilRoomStats";

describe("room totals", () => {
  it("sums usage and priced replies", () => {
    expect(sumCouncilReplies([{ metadata: { councilReliability: { usage: { inputTokens: 10, outputTokens: 5 }, costCents: "0.2" } } }, { metadata: { councilReliability: { usage: { inputTokens: 3 }, costCents: "1" } } }])).toEqual({ replies: 2, tokens: 18, allHaveTokens: true, cost: "$0.012" });
  });
  it("distinguishes local, missing prices and missing usage", () => {
    expect(sumCouncilReplies([{ metadata: { councilReliability: { local: true } } }]).cost).toBe("FREE (Local)");
    expect(sumCouncilReplies([{ metadata: { councilReliability: { local: true } } }, {}])).toEqual({ replies: 2, tokens: null, allHaveTokens: false, cost: "cost unavailable" });
    expect(renderToStaticMarkup(<CouncilRoomStats replies={[]} />)).toBe("");
  });
  it("marks partial token totals", () => {
    const replies = [{ metadata: { councilReliability: { usage: { inputTokens: 10 } } } }, {}];
    expect(sumCouncilReplies(replies).allHaveTokens).toBe(false);
    expect(renderToStaticMarkup(<CouncilRoomStats replies={replies} />)).toContain("2 replies · at least 10 tokens");
  });
  it("formats messages in order", () => {
    expect(formatCouncilMarkdown([{ name: "You", body: "Hello" }, { name: "Ada", body: "First\nSecond" }])).toBe("**You:** Hello\n\n**Ada:** First\nSecond");
  });
});
