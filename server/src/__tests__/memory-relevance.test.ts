import { describe, expect, it } from "vitest";
import { memoryContext, rankMemory, relatedEntries, selectMemoryContext } from "../services/memory.js";

type Entry = Parameters<typeof selectMemoryContext>[0][number];
function entry(id: string, values: Partial<Entry> = {}): Entry {
  return {
    id, title: id, body: "", tags: [], pinned: false, kind: "fact",
    sourceLabel: null, sourceUrl: null, createdByLabel: "Board",
    updatedAt: new Date("2025-01-01"), ...values,
  } as Entry;
}

describe("memory relevance", () => {
  const body = entry("body", { body: "launch plans" });
  const tag = entry("tag", { tags: ["launch"] });
  const title = entry("title", { title: "Launch schedule" });
  const pinned = entry("pinned", { pinned: true });
  const unrelated = entry("unrelated", { updatedAt: new Date("2026-01-01") });
  const entries = [body, unrelated, tag, title, pinned];

  it("orders ties by id without a query and keeps pinned entries first", () => {
    expect(selectMemoryContext(entries).entries).toEqual([pinned, body, tag, title, unrelated]);
    expect(selectMemoryContext(entries, { query: "the and" }).entries).toEqual([pinned, body, tag, title, unrelated]);
  });
  it("weights title, tags and body matches, with recency only breaking ties", () => {
    const newerBody = entry("newer", { body: "LAUNCH", updatedAt: new Date("2026-01-01") });
    expect(selectMemoryContext([...entries, newerBody], { query: "The LAUNCH" }).entries)
      .toEqual([pinned, title, tag, newerBody, body, unrelated]);
  });
  it("respects the existing context budget and forwards query through memoryContext", () => {
    const first = selectMemoryContext([title], { query: "launch" }).text;
    const result = selectMemoryContext([body, title], { query: "launch", maxChars: first.length });
    expect(result.entries).toEqual([title]);
    expect(result.text.length).toBeLessThanOrEqual(first.length);
    expect(memoryContext([body, title], { query: "launch", maxChars: first.length })).toBe(first);
  });
  it("finds related entries by shared tags and title words, excluding itself and unrelated entries", () => {
    const source = entry("source", { title: "Launch plan", tags: ["Ops"] });
    const both = entry("both", { title: "Launch notes", tags: ["ops"] });
    const one = entry("one", { title: "Plan review" });
    expect(relatedEntries([source, one, unrelated, both], source)).toEqual([both, one]);
    expect(relatedEntries([one, both], source, 1)).toEqual([both]);
  });
  it("uses entry id to break ties regardless of input order", () => {
    const a = entry("a", { title: "Launch plan" });
    const b = entry("b", { title: "Launch plan" });
    const source = entry("source", { title: "Launch plan" });
    for (const items of [[b, a], [a, b]]) {
      expect(rankMemory(items, "launch")).toEqual([a, b]);
      expect(selectMemoryContext(items, { query: "launch" }).entries).toEqual([a, b]);
      expect(selectMemoryContext(items).entries).toEqual([a, b]);
      expect(relatedEntries(items, source)).toEqual([a, b]);
    }
  });
  it("retains every-word search matching", () => {
    expect(rankMemory([title, body], "launch plans")).toEqual([body]);
  });
});
