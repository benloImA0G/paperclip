import { describe, expect, it } from "vitest";
import { chooseRoute } from "../services/council-route-choice.js";

describe("chooseRoute", () => {
  it("empty string -> single", () => {
    expect(chooseRoute({ question: "" }).route).toBe("single");
  });
  it("short factual question -> single", () => {
    const r = chooseRoute({ question: "What is the capital of France?" });
    expect(r.route).toBe("single");
    expect(r.reason.length).toBeGreaterThan(0);
  });
  it("decision words -> council", () => {
    expect(chooseRoute({ question: "Should I hire a developer?" }).route).toBe("council");
  });
  it("comparison -> council", () => {
    expect(chooseRoute({ question: "Compare Postgres and MySQL" }).route).toBe("council");
  });
  it("Indonesian sebaiknya -> council", () => {
    expect(chooseRoute({ question: "Sebaiknya saya pakai apa?" }).route).toBe("council");
  });
  it("Indonesian pilih mana -> council", () => {
    expect(chooseRoute({ question: "Pilih mana, A atau B?" }).route).toBe("council");
  });
  it("attachments -> council", () => {
    expect(chooseRoute({ question: "Summarize this", attachmentCount: 1 }).route).toBe("council");
  });
  it("explicit council mode -> council", () => {
    expect(chooseRoute({ question: "Hi", mode: "council" }).route).toBe("council");
  });
  it("long question -> council", () => {
    const q = Array(30).fill("word").join(" ");
    expect(chooseRoute({ question: q }).route).toBe("council");
  });
  it("multi-part question -> council", () => {
    expect(chooseRoute({ question: "What is A? What is B?" }).route).toBe("council");
  });
});
