import { describe, expect, it } from "vitest";
import { COUNCIL_TEMPLATES, councilCallEstimate } from "./council-templates";

describe("council room templates", () => {
  it("estimates seat rounds plus one orchestrator call", () => {
    expect(councilCallEstimate(COUNCIL_TEMPLATES[0], 4)).toBe(4);
    expect(councilCallEstimate(COUNCIL_TEMPLATES[1], 4)).toBe(13);
    expect(councilCallEstimate(COUNCIL_TEMPLATES[3], 4)).toBe(17);
  });

  it("keeps balanced debate as the default and decision roles explicit", () => {
    expect(COUNCIL_TEMPLATES[1].id).toBe("balanced-debate");
    expect(COUNCIL_TEMPLATES[2].roles).toMatchObject({ Techie: "critic", CodeBot: "researcher" });
  });

  it("estimates the chain preset as one call per seat", () => {
    const template = COUNCIL_TEMPLATES.find((item) => item.id === "builder-reviewer")!;
    expect(template).toMatchObject({ answerStyle: "chain", roles: { Creative: "builder", Techie: "critic" } });
    expect(councilCallEstimate(template, 2)).toBe(2);
  });

  it("defines the research, build, review chain", () => {
    const template = COUNCIL_TEMPLATES.find((item) => item.id === "research-build-review")!;
    expect(template).toMatchObject({ answerStyle: "chain", roles: { Creative: "researcher", Techie: "builder", CodeBot: "critic" } });
    expect(councilCallEstimate(template, 3)).toBe(3);
  });

  it("has unique ids and all required fields", () => {
    expect(new Set(COUNCIL_TEMPLATES.map((template) => template.id)).size).toBe(COUNCIL_TEMPLATES.length);
    for (const template of COUNCIL_TEMPLATES) {
      expect(template).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), whatHappens: expect.any(String), title: expect.any(String), discussion: expect.any(Boolean), depth: expect.any(String), autoSummary: expect.any(Boolean), requireApproval: expect.any(Boolean), roles: expect.any(Object), rounds: expect.any(Number) }));
      expect(template).toHaveProperty("orchestrator");
    }
  });

  it("sets the recipe switches for each new preset", () => {
    const byId = (id: string) => COUNCIL_TEMPLATES.find((template) => template.id === id);
    expect(byId("blind-best-of-n")).toMatchObject({ panelSize: 4, peerRanking: true, jury: true, discussion: false, rounds: 1, autoSummary: true });
    expect(byId("debate-to-agreement")).toMatchObject({ discussion: true, depth: "agree" });
    expect(byId("fresh-angles")).toMatchObject({ panelSize: 3, discussion: false, rounds: 1, autoSummary: true });
    expect(byId("get-it-done")).toMatchObject({ workMode: "plan-first", askFirst: true, juryChecks: true, draftTasks: true });
  });

  it("keeps the original template settings unchanged", () => {
    expect(COUNCIL_TEMPLATES.slice(0, 4)).toEqual([
      { id: "quick-check", name: "Quick check", whatHappens: "Everyone answers once. No debate or summary.", title: "Quick check", discussion: false, depth: "low", autoSummary: false, requireApproval: false, orchestrator: null, roles: {}, rounds: 1 },
      { id: "balanced-debate", name: "Balanced debate", whatHappens: "Everyone answers, then weighs trade-offs together.", title: "Balanced debate", discussion: true, depth: "medium", autoSummary: false, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator" }, rounds: 3 },
      { id: "decision", name: "Decision", whatHappens: "The room debates and publishes a decision record for export.", title: "Decision", discussion: true, depth: "medium", autoSummary: true, requireApproval: true, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "researcher" }, rounds: 3 },
      { id: "red-team", name: "Red-team", whatHappens: "Critics challenge the idea while research fills the gaps.", title: "Red-team", discussion: true, depth: "high", autoSummary: true, requireApproval: false, orchestrator: "Creative", roles: { Creative: "moderator", Techie: "critic", CodeBot: "critic", Friendly: "researcher" }, rounds: 4 },
    ]);
  });
});
