import { describe, expect, it } from "vitest";
import { buildCouncilFollowUp } from "../services/council-followup.js";

const now = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const task = (over: Partial<Parameters<typeof buildCouncilFollowUp>[0][number]> = {}) => ({
  id: "t1", identifier: "PAP-1", title: "Do it", status: "todo", assigneeName: "Ada", updatedAt: now, latestComment: null, ...over,
});

describe("buildCouncilFollowUp", () => {
  it("handles an empty room", () => {
    const result = buildCouncilFollowUp([], now);
    expect(result.summary).toEqual({ total: 0, done: 0, blocked: 0, inProgress: 0, open: 0 });
    expect(result.headline).toBe("No tasks from this room yet");
    expect(result.items).toEqual([]);
  });

  it("counts statuses and writes the headline", () => {
    const result = buildCouncilFollowUp([
      task({ id: "a", status: "done" }), task({ id: "b", status: "done" }),
      task({ id: "c", status: "blocked" }), task({ id: "d", status: "in_progress" }), task({ id: "e", status: "backlog" }),
    ], now);
    expect(result.summary).toEqual({ total: 5, done: 2, blocked: 1, inProgress: 1, open: 1 });
    expect(result.headline).toBe("2 of 5 done, 1 blocked, 1 in progress");
  });

  it("collapses whitespace, strips markup and trims to 240 characters", () => {
    const long = buildCouncilFollowUp([task({ latestComment: `**Result**\n\n${"word ".repeat(100)}` })], now).items[0]!;
    expect(long.outcome!.length).toBeLessThanOrEqual(240);
    expect(long.outcome!.endsWith("…")).toBe(true);
    expect(long.outcome).not.toContain("\n");
    expect(long.outcome).not.toContain("*");
    expect(buildCouncilFollowUp([task({ latestComment: "  a \n b  " })], now).items[0]!.outcome).toBe("a b");
    expect(buildCouncilFollowUp([task()], now).items[0]!.outcome).toBeNull();
  });

  it("flags stale only for unfinished tasks idle 3+ days", () => {
    const items = buildCouncilFollowUp([
      task({ id: "a", updatedAt: daysAgo(3) }),
      task({ id: "b", updatedAt: daysAgo(2) }),
      task({ id: "c", status: "done", updatedAt: daysAgo(10) }),
    ], now).items;
    expect(items.map((item) => item.stale)).toEqual([true, false, false]);
    expect(items[0]!.staleDays).toBe(3);
  });
});
