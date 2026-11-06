import { describe, expect, it } from "vitest";
import { estimateCalls, type CallEstimateOptions } from "./council-call-estimate";

const base: CallEstimateOptions = {
  answeringSeats: 3, hasModerator: false, rounds: 1, untilAgreement: false,
  autoSummary: false, clarify: false, peerRanking: false, jury: false, panelSize: 0,
  work: { planFirst: false, askFirst: false, juryChecks: false, finalReview: false },
};
const bounds = (options: CallEstimateOptions) => {
  const { low, high } = estimateCalls(options);
  return [low, high];
};

describe("estimateCalls", () => {
  it("counts answers and the moderator only for at least two seats", () => {
    expect(bounds(base)).toEqual([3, 3]);
    expect(bounds({ ...base, hasModerator: true })).toEqual([4, 4]);
    expect(bounds({ ...base, answeringSeats: 1, hasModerator: true })).toEqual([1, 1]);
  });
  it("clamps the panel to available answering seats", () => {
    expect(bounds({ ...base, panelSize: 2 })).toEqual([2, 2]);
    expect(bounds({ ...base, panelSize: 6 })).toEqual([3, 3]);
  });
  it("counts fixed discussion rounds and moderator cards", () => {
    expect(bounds({ ...base, rounds: 3, hasModerator: true })).toEqual([12, 12]);
  });
  it("bounds agreement discussions and possible stance follow-ups", () => {
    expect(bounds({ ...base, untilAgreement: true, hasModerator: true })).toEqual([8, 25]);
  });
  it("adds summary and possible clarification", () => {
    expect(bounds({ ...base, autoSummary: true, clarify: true })).toEqual([4, 7]);
  });
  it("requires three answers for ranking and caps it at six", () => {
    expect(bounds({ ...base, answeringSeats: 2, peerRanking: true })).toEqual([2, 2]);
    expect(bounds({ ...base, peerRanking: true })).toEqual([6, 6]);
    expect(bounds({ ...base, answeringSeats: 8, peerRanking: true })).toEqual([14, 14]);
  });
  it("requires two answers for a jury and caps it at six", () => {
    expect(bounds({ ...base, answeringSeats: 1, jury: true })).toEqual([1, 1]);
    expect(bounds({ ...base, jury: true })).toEqual([5, 5]);
    expect(bounds({ ...base, answeringSeats: 9, jury: true })).toEqual([15, 15]);
  });
  it("estimates four work steps with and without jury checks", () => {
    const work = { ...base.work, planFirst: true };
    expect(bounds({ ...base, work })).toEqual([10, 19]);
    expect(bounds({ ...base, work: { ...work, juryChecks: true } })).toEqual([18, 27]);
  });
  it("includes work questions, final review, and custom step count", () => {
    expect(bounds({ ...base, work: { ...base.work, planFirst: true, askFirst: true, finalReview: true, steps: 2 } })).toEqual([8, 15]);
  });
  it("explains enabled costs", () => {
    expect(estimateCalls({ ...base, peerRanking: true, jury: true }).lines).toEqual(expect.arrayContaining(["3 seats answer", "Ranking adds 3", "Jury adds 2"]));
  });
});
