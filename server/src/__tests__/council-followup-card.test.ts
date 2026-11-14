import { describe, expect, it } from "vitest";
import { buildResultCard, shouldPostCard, type CouncilTaskResultStatus } from "../services/council-followup-card.js";

const task = { taskId: "task-1", title: "Write a report", status: "done" as const, ownerName: "Alex", resultText: "Report ready", finishedAt: "2026-11-14T00:00:00Z" };

describe("council task result cards", () => {
  it.each([
    ["done", "Review the result"],
    ["failed", "Ask the council to retry or change the plan"],
    ["blocked", "Something needs your decision"],
    ["cancelled", "No action needed"],
  ] as [CouncilTaskResultStatus, string][])("shows the next step for %s", (status, next) => {
    const card = buildResultCard({ ...task, status });
    expect(card).toMatchObject({ kind: "council_task_result", taskId: task.taskId, status });
    expect(card.markdown).toContain(`${status.toUpperCase()}: Write a report`);
    expect(card.markdown).toContain(next);
    expect(card.markdown).toContain("Owner: Alex");
  });

  it("truncates a long result at a word boundary", () => {
    const card = buildResultCard({ ...task, resultText: `${"word ".repeat(150)}tail` });
    const result = card.markdown.split("Result: ")[1].split("\n\n")[0];
    expect(result.length).toBeLessThanOrEqual(600);
    expect(result).toMatch(/word…$/);
  });

  it("bounds a single long word", () => {
    const card = buildResultCard({ ...task, resultText: "x".repeat(700) });
    expect(card.markdown).toContain(`${"x".repeat(599)}…`);
  });

  it("removes secret-bearing lines while retaining other result lines", () => {
    const card = buildResultCard({ ...task, resultText: "Useful result\nsk-example\nBearer example\ntoken=example\nStill useful" });
    expect(card.markdown).toContain("Useful result\nStill useful");
    expect(card.markdown).not.toContain("example");
  });

  it("provides defaults for missing owner and result", () => {
    const card = buildResultCard({ ...task, ownerName: undefined, resultText: undefined });
    expect(card.markdown).toContain("Owner: Unassigned");
    expect(card.markdown).toContain("Result: No result provided.");
  });

  it.each(["done", "failed", "blocked", "cancelled"])("posts on entry to %s but not on repetition", (status) => {
    expect(shouldPostCard("in_progress", status)).toBe(true);
    expect(shouldPostCard(status, status)).toBe(false);
  });

  it("does not post on a nonterminal transition", () => {
    expect(shouldPostCard("blocked", "in_progress")).toBe(false);
  });
});
