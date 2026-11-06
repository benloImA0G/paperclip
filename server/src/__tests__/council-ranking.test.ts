import { describe, expect, it } from "vitest";
import { aggregateRankings, blindLabels, buildJuryPrompt, buildRankingPrompt, parseJuryVerdict, parseRanking, tallyJury } from "../services/council-ranking.js";

const labels = ["Seat A", "Seat B", "Seat C"];

describe("ranking", () => {
  it("makes blind labels", () => {
    expect(blindLabels(3)).toEqual(labels);
    expect(blindLabels(0)).toEqual([]);
  });
  it("builds a prompt with untrusted answers and no vendor names", () => {
    const p = buildRankingPrompt({ question: "Q?", answers: [{ label: "Seat A", text: "one" }, { label: "Seat B", text: "two" }] });
    expect(p).toContain("BEGIN UNTRUSTED ANSWER SEAT A");
    expect(p).toContain("letters: A, B");
  });
  it("parses letters, labels and loose formatting", () => {
    expect(parseRanking("RANKING: B > A > C\nWHY: clearer", labels)).toEqual(["Seat B", "Seat A", "Seat C"]);
    expect(parseRanking("**RANKING:** Seat C > Seat A > Seat B", labels)).toEqual(["Seat C", "Seat A", "Seat B"]);
  });
  it("ignores trailing words that look like letters", () => {
    expect(parseRanking("RANKING: B > A > C (a close call)", labels)).toEqual(["Seat B", "Seat A", "Seat C"]);
    expect(parseRanking("RANKING: Seat B > Seat A > Seat C. A tough one", labels)).toEqual(["Seat B", "Seat A", "Seat C"]);
  });
  it("rejects missing, duplicate or unknown labels", () => {
    expect(parseRanking("RANKING: A > B", labels)).toBeNull();
    expect(parseRanking("RANKING: A > A > B", labels)).toBeNull();
    expect(parseRanking("RANKING: A > B > D", labels)).toBeNull();
    expect(parseRanking("no ranking here", labels)).toBeNull();
  });
  it("aggregates with Borda and tie-breaks", () => {
    const result = aggregateRankings([["Seat A", "Seat B", "Seat C"], ["Seat B", "Seat A", "Seat C"], ["Seat A", "Seat C", "Seat B"]], labels);
    expect(result[0]).toEqual({ label: "Seat A", points: 5, firstPlace: 2 });
    expect(result.map((r) => r.label)).toEqual(["Seat A", "Seat B", "Seat C"]);
    const tie = aggregateRankings([["Seat A", "Seat B", "Seat C"], ["Seat B", "Seat A", "Seat C"]], labels);
    expect(tie[0]!.label).toBe("Seat A");
  });
});

describe("jury", () => {
  it("builds and parses verdicts", () => {
    expect(buildJuryPrompt({ question: "Q", answer: "A" })).toContain("BEGIN UNTRUSTED ANSWER");
    expect(parseJuryVerdict("**VERDICT: PASS**\nWHY: solid")).toEqual({ verdict: "pass", why: "solid" });
    expect(parseJuryVerdict("verdict: revise")?.verdict).toBe("revise");
    expect(parseJuryVerdict("hmm")).toBeNull();
  });
  it("tallies by majority, ties revise", () => {
    expect(tallyJury(["pass", "pass", "fail"])).toMatchObject({ verdict: "pass", unanimous: false });
    expect(tallyJury(["fail", "fail"])).toMatchObject({ verdict: "fail", unanimous: true });
    expect(tallyJury(["pass", "fail"]).verdict).toBe("revise");
    expect(tallyJury([]).verdict).toBe("revise");
  });
});
