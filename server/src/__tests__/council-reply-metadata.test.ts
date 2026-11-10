import { describe, expect, it } from "vitest";
import { issueCommentMetadataSchema } from "@paperclipai/shared";

// The seat-reply metadata written by council-chat.ts is validated by a strict schema when the comment is saved.
// A new field that is missing from the schema makes every reply fail to save (found with "Ask again"), and unit
// tests that mock addComment cannot see that, so this test checks the real shape against the real schema.
describe("council reply metadata", () => {
  const full = {
    version: 1 as const,
    councilReliability: {
      durationMs: 1234,
      fallbackUsed: false,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      costCents: "0.12",
      costStatus: "accepted",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      local: false,
      askedAgain: "What is the best first step for a small team?",
    },
    sections: [{ rows: [{ type: "text" as const, text: "Council seat reply reliability details." }] }],
  };

  it("accepts every field a seat reply can carry, including askedAgain", () => {
    expect(issueCommentMetadataSchema.parse(full)).toEqual(full);
  });

  it("still rejects unknown fields so typos are caught", () => {
    expect(() => issueCommentMetadataSchema.parse({ ...full, councilReliability: { ...full.councilReliability, bogus: 1 } })).toThrow();
  });
});
