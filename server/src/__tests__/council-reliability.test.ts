import { describe, expect, it } from "vitest";
import { calculateCouncilReliability } from "../services/council-reliability.js";

describe("council reliability", () => {
  it("summarizes seat replies and leaves missing run details unknown", () => {
    const result = calculateCouncilReliability(
      [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
      [
        { authorUserId: "council-seat:a", metadata: { councilReliability: { durationMs: 1000, fallbackUsed: false } } },
        { authorUserId: "council-seat:a", metadata: { councilReliability: { durationMs: 3000, fallbackUsed: true } } },
        { authorUserId: "council-seat:b", metadata: null },
        { authorUserId: "board-user", metadata: null },
      ],
    );
    expect(result.seats).toEqual([
      { seatId: "a", seatName: "Alpha", replies: 2, averageLatencyMs: 2000, fallbackRate: 0.5 },
      { seatId: "b", seatName: "Beta", replies: 1, averageLatencyMs: null, fallbackRate: null },
    ]);
    expect(result.totals).toEqual({ replies: 3, averageLatencyMs: 2000, fallbackRate: 0.5 });
  });
});
