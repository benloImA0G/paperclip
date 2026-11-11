import { describe, expect, it } from "vitest";
import { findSimilarGroups, lessonSimilarity } from "../services/memory.js";

describe("lesson similarity", () => {
  const a = { title: "Improve subject lines", body: "Avoid clickbait and write clear subject lines" };
  it("compares normalized word sets", () => {
    expect(lessonSimilarity(a, { title: "IMPROVE subject lines!", body: "Avoid clickbait and write clear subject lines." })).toBe(1);
    expect(lessonSimilarity(a, { title: "Improve clear subject lines", body: "Write subject lines and avoid clickbait" })).toBeGreaterThanOrEqual(0.6);
    expect(lessonSimilarity(a, { title: "Database backups", body: "Schedule daily snapshots" })).toBe(0);
    expect(lessonSimilarity({ title: "the", body: "" }, { title: "", body: "and" })).toBe(0);
  });
  it("groups connected active and pending entries by kind", () => {
    const entries = [
      { ...a, id: "a", kind: "lesson", status: "active" },
      { ...a, id: "b", kind: "lesson", status: "pending" },
      { ...a, id: "c", kind: "lesson", status: "withdrawn" },
      { ...a, id: "d", kind: "fact", status: "active" },
    ];
    expect(findSimilarGroups(entries, 0.6).map((group) => group.map((entry) => entry.id))).toEqual([["a", "b"]]);
  });
});
