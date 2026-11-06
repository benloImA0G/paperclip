import { describe, expect, it } from "vitest";
import { PERSONAS, anonymize, assignPersonas, blindLabels, personaInstruction, pickPanel, type PanelCandidate } from "../services/council-panel.js";

const pool: PanelCandidate[] = [
  { id: "1", name: "GPT", vendor: "openai", model: "a" },
  { id: "2", name: "GPT2", vendor: "openai", model: "b" },
  { id: "3", name: "Groq", vendor: "groq", model: "c" },
  { id: "4", name: "Nemo", vendor: "nvidia", model: "d" },
  { id: "5", name: "Gem", vendor: "google", model: "e" },
  { id: "6", name: "Gem2", vendor: "Google", model: "f" },
];

describe("pickPanel", () => {
  it("is deterministic for a seed", () => {
    expect(pickPanel(pool, { size: 3, seed: 7 }).map((c) => c.id)).toEqual(pickPanel(pool, { size: 3, seed: 7 }).map((c) => c.id));
  });
  it("uses one seat per vendor first", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const vendors = pickPanel(pool, { size: 4, seed }).map((c) => c.vendor.toLowerCase());
      expect(new Set(vendors).size).toBe(4);
    }
  });
  it("fills with repeats only when vendors run out, never duplicates a seat", () => {
    const panel = pickPanel(pool, { size: 6, seed: 3 });
    expect(new Set(panel.map((c) => c.id)).size).toBe(6);
  });
  it("clamps size and handles empty or duplicate input", () => {
    expect(pickPanel([], { size: 3 })).toEqual([]);
    expect(pickPanel(pool, { size: 99, seed: 1 }).length).toBe(6);
    expect(pickPanel(pool, { size: 0, seed: 1 }).length).toBe(1);
    expect(pickPanel([pool[0]!, pool[0]!], { size: 2, seed: 1 }).length).toBe(1);
  });
  it("can ignore vendor diversity", () => {
    expect(pickPanel(pool, { size: 3, seed: 2, diverseVendors: false }).length).toBe(3);
  });
});

describe("personas and labels", () => {
  it("assigns distinct personas while they last", () => {
    const panel = pickPanel(pool, { size: 6, seed: 5 });
    const map = assignPersonas(panel, 5);
    expect(new Set([...map.values()].map((p) => p.id)).size).toBe(Math.min(6, PERSONAS.length));
    expect(personaInstruction([...map.values()][0]!)).toContain("angle");
  });
  it("labels seats A, B, C", () => {
    expect(blindLabels(3)).toEqual(["Seat A", "Seat B", "Seat C"]);
  });
  it("anonymizes with a reveal map and hides seat ids", () => {
    const { answers, reveal } = anonymize([{ seatId: "x", text: "one" }, { seatId: "y", text: "two" }, { seatId: "z", text: "three" }], 11);
    expect(answers.map((a) => a.label)).toEqual(["Seat A", "Seat B", "Seat C"]);
    expect(JSON.stringify(answers)).not.toMatch(/"seatId"|"x"|"y"|"z"/);
    expect([...reveal.values()].sort()).toEqual(["x", "y", "z"]);
  });
});
