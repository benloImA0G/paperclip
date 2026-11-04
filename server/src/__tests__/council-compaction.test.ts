import { describe, expect, it } from "vitest";
import { compactCouncilHistory } from "../services/council-chat.js";

const seat = (n: number, body: string) => ({ authorUserId: `council-seat:s${n}`, body });
const ben = (body: string) => ({ authorUserId: null, body });
const long = (label: string) => `${label} ${"word ".repeat(400)}`;

describe("compactCouncilHistory", () => {
  it("leaves a short thread untouched", () => {
    const history = [ben("question"), seat(1, "answer"), seat(2, "answer")];
    const out = compactCouncilHistory(history);
    expect(out.compacted).toBe(0);
    expect(out.bodies).toEqual(history.map((c) => c.body));
  });

  it("shortens older turns once over budget and keeps the latest round verbatim", () => {
    const history = [
      ben(long("question")),
      seat(1, long("round1-a")),
      seat(2, long("round1-b")),
      ben("focus note"),
      seat(1, long("round2-a")),
      seat(2, long("round2-b")),
    ];
    const out = compactCouncilHistory(history, 500);
    expect(out.bodies[1].length).toBeLessThan(220);
    expect(out.bodies[1]).toContain("[shortened earlier turn]");
    expect(out.bodies[0].length).toBeLessThan(700);
    expect(out.bodies.slice(3)).toEqual(history.slice(3).map((c) => c.body));
    expect(out.compacted).toBe(3);
  });

  it("keeps an earlier seat Summary verbatim", () => {
    const summary = `Summary\n${"agreed ".repeat(200)}`;
    const history = [ben(long("q")), seat(1, summary), ben("go on"), seat(2, long("latest"))];
    const out = compactCouncilHistory(history, 100);
    expect(out.bodies[1]).toBe(summary);
  });
});
