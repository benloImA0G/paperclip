import { describe, expect, it } from "vitest";
import { matchMentionedSeats } from "../services/council-chat.js";

const seats = [{ name: "Chair" }, { name: "Smoke A" }, { name: "Smoke B" }, { name: "Gemini Flash" }];

describe("matchMentionedSeats", () => {
  it("picks only the seat named in full", () => {
    expect(matchMentionedSeats("@smoke b say hi", seats).map((s) => s.name)).toEqual(["Smoke B"]);
  });
  it("does not match every seat that shares a first word", () => {
    expect(matchMentionedSeats("@smoke say hi", seats)).toEqual([]);
  });
  it("accepts a unique first word", () => {
    expect(matchMentionedSeats("@gemini what do you think", seats).map((s) => s.name)).toEqual(["Gemini Flash"]);
  });
  it("matches several seats when several are named", () => {
    expect(matchMentionedSeats("@chair and @smoke a go", seats).map((s) => s.name)).toEqual(["Chair", "Smoke A"]);
  });
  it("does not match a longer word", () => {
    expect(matchMentionedSeats("@chairman hello", seats)).toEqual([]);
  });
});
