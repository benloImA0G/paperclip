import { describe, expect, it } from "vitest";
import { planFreeTeam } from "./council-free-team";

const connections = [
  { id: "g", name: "Google", provider: "gemini" },
  { id: "n", name: "NVIDIA" },
  { id: "q", name: "My GROQ" },
  { id: "o", name: "Local" },
  { id: "extra", name: "Ollama" },
];

describe("planFreeTeam", () => {
  it("assigns Chairman to Groq and uses the role presets", () => {
    const plans = planFreeTeam(connections, []);
    expect(plans[0]).toMatchObject({ connectionId: "q", name: "Chairman", roleId: "chairman", role: "moderator" });
    expect(plans.map((plan) => plan.roleId)).toEqual(["chairman", "builder", "reviewer", "contrarian"]);
    expect(plans.every((plan) => plan.model && plan.persona)).toBe(true);
  });

  it("puts the quick cloud vendors first and the slow local model last", () => {
    expect(planFreeTeam(connections, []).map((plan) => plan.connectionId)).toEqual(["q", "g", "n", "o"]);
  });

  it("does not duplicate existing names, ignoring case and whitespace", () => {
    const plans = planFreeTeam(connections, [" chairman ", "REVIEWER"]);
    expect(plans.map((plan) => plan.name)).toEqual(["Builder", "Contrarian"]);
  });

  it("uses at most four distinct connections", () => {
    const plans = planFreeTeam([...connections, connections[0]], []);
    expect(plans).toHaveLength(4);
    expect(new Set(plans.map((plan) => plan.connectionId)).size).toBe(4);
  });

  it("returns no plans when no free AI is connected", () => {
    expect(planFreeTeam([{ id: "paid", name: "OpenAI" }], [])).toEqual([]);
  });
});
