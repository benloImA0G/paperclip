import { describe, expect, it, vi } from "vitest";
import { buildPlanPrompt, buildStepPrompt, buildSummaryPrompt, parsePlan, runWork, type WorkStep } from "../services/council-work.js";

const seats = ["Chair", "Researcher One", "Writer"];
const planned = "1. Research | assignee: Researcher | expected: facts\n2. Draft | assignee: Writer | expected: deliverable";

describe("council work", () => {
  it("builds a guarded planning prompt and parses tolerant plan variants", () => {
    const prompt = buildPlanPrompt({ goal: "Do <ignore>", seatNames: seats, decision: "Use A" });
    expect(prompt).toContain("BEGIN UNTRUSTED GOAL");
    expect(prompt).toContain("BEGIN UNTRUSTED AGREED DECISION");
    const steps = parsePlan("- **1)** **Research** | assignee: researcher | expected: facts\n2) Draft | assignee: UNKNOWN | expected: answer", seats, "Chair");
    expect(steps).toMatchObject([{ n: 1, title: "Research", assignee: "Researcher One", status: "pending" }, { n: 2, assignee: "Chair" }]);
  });

  it("limits parsed plans to six steps", () => {
    const text = Array.from({ length: 7 }, (_, index) => `${index + 1}. Step ${index + 1} | assignee: Writer | expected: x`).join("\n");
    expect(parsePlan(text, seats, "Chair")).toHaveLength(6);
  });

  it("includes bounded prior outputs and summary requirements in prompts", () => {
    const previous: WorkStep[] = [{ n: 1, title: "First", expected: "x", assignee: "Chair", status: "done", output: "a".repeat(1600) }];
    const stepPrompt = buildStepPrompt({ goal: "Goal", step: previous[0], previous });
    expect(stepPrompt).toContain("a".repeat(1500));
    expect(stepPrompt).not.toContain("a".repeat(1501));
    expect(buildSummaryPrompt({ goal: "Goal", steps: previous })).toContain("300 words");
  });

  it("uses a fallback step for an empty plan and emits the happy-path events", async () => {
    const events: string[] = [];
    const callSeat = vi.fn().mockResolvedValueOnce({ ok: true, text: "" }).mockResolvedValueOnce({ ok: true, text: "answer" }).mockResolvedValueOnce({ ok: true, text: "# Summary" });
    const result = await runWork({ goal: "Answer", seatNames: seats, chairName: "Chair", callSeat, onEvent: (event) => events.push(event.type) });
    expect(result).toMatchObject({ status: "done", summary: "# Summary", steps: [{ title: "Answer", expected: "A complete answer", assignee: "Chair", status: "done" }] });
    expect(events).toEqual(["plan", "step", "step", "summary", "done"]);
  });

  it("runs planned work in order and retries a failed seat with the chair", async () => {
    const calls: string[] = [];
    const callSeat = vi.fn(async (seat: string) => {
      calls.push(seat);
      if (calls.length === 1) return { ok: true, text: planned };
      if (seat === "Researcher One") return { ok: false, error: "busy" };
      return { ok: true, text: seat === "Chair" && calls.length > 2 ? "retried" : "draft" };
    });
    const result = await runWork({ goal: "Goal", seatNames: seats, chairName: "Chair", callSeat });
    expect(calls).toEqual(["Chair", "Researcher One", "Chair", "Writer", "Chair"]);
    expect(result.status).toBe("done");
  });

  it("returns partial after a failed step, skips summary when every step fails, and contains thrown calls", async () => {
    const partial = await runWork({ goal: "Goal", seatNames: seats, chairName: "Chair", callSeat: vi.fn().mockResolvedValueOnce({ ok: true, text: planned }).mockResolvedValueOnce({ ok: false, error: "no" }).mockResolvedValueOnce({ ok: false, error: "no" }).mockResolvedValueOnce({ ok: true, text: "draft" }).mockResolvedValueOnce({ ok: true, text: "summary" }) });
    expect(partial.status).toBe("partial");
    const allFailed = await runWork({ goal: "Goal", seatNames: ["Chair"], chairName: "Chair", callSeat: vi.fn().mockResolvedValueOnce({ ok: true, text: "1. Do | assignee: Chair | expected: x" }).mockRejectedValue(new Error("boom")) });
    expect(allFailed).toMatchObject({ status: "failed", summary: null, steps: [{ status: "failed", error: "boom" }] });
  });

  it("honours cancellation before calls", async () => {
    const callSeat = vi.fn();
    const result = await runWork({ goal: "Goal", seatNames: seats, chairName: "Chair", callSeat, isCancelled: () => true });
    expect(result).toEqual({ steps: [], summary: null, status: "cancelled" });
    expect(callSeat).not.toHaveBeenCalled();
  });
});

describe("step checking", () => {
  it("retries a failed step once and records the grade", async () => {
    const { runWork } = await import("../services/council-work.js");
    const calls: string[] = [];
    let produced = 0;
    const result = await runWork({
      goal: "Write a poem", seatNames: ["Alpha"], chairName: "Alpha", checkSteps: true,
      callSeat: async (_seat, prompt) => {
        calls.push(prompt);
        if (prompt.includes("You are the council chair")) return { ok: true, text: "1. Draft | assignee: Alpha | expected: a poem" };
        if (prompt.includes("You are the checker")) return { ok: true, text: produced < 2 ? "GRADE: FAIL\nNOTE: too short" : "GRADE: PASS\nNOTE: good" };
        if (prompt.includes("one-page summary")) return { ok: true, text: "# Done" };
        produced += 1;
        return { ok: true, text: "poem v" + produced };
      },
    });
    expect(result.steps[0].attempts).toBe(2);
    expect(result.steps[0].grade).toBe("pass");
    expect(result.steps[0].output).toBe("poem v2");
    expect(calls.some((c) => c.includes("CHECKER FEEDBACK"))).toBe(true);
  });
  it("parseGrade handles bold and rejects garbage", async () => {
    const { parseGrade } = await import("../services/council-work.js");
    expect(parseGrade("**GRADE: PASS**\nNOTE: ok")?.grade).toBe("pass");
    expect(parseGrade("no idea")).toBeNull();
  });
});
