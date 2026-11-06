import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkStep } from "../api/council";
import { CouncilWorkPanel, CouncilWorkStep } from "./council-work-step";

const step: WorkStep = { n: 3, title: "Draft", expected: "A draft", assignee: "Alex", status: "done" };

describe("council work steps", () => {
  it("shows a grade, its note, retry and each dependency", () => {
    const html = renderToStaticMarkup(<CouncilWorkStep step={{ ...step, grade: "fail", gradeNote: "Needs details", attempts: 2, after: [1, 2] }} />);
    expect(html).toContain("checked: fail");
    expect(html).toContain('title="Needs details"');
    expect(html).toContain("retried");
    expect(html).toContain("waits for step 1");
    expect(html).toContain("waits for step 2");
  });

  it("shows a passing check and omits absent details", () => {
    const html = renderToStaticMarkup(<CouncilWorkStep step={{ ...step, grade: "pass", attempts: 1, after: [] }} />);
    expect(html).toContain("checked: pass");
    expect(html).not.toContain("retried");
    expect(html).not.toContain("waits for step");
    expect(renderToStaticMarkup(<CouncilWorkStep step={step} />)).not.toContain("checked:");
  });

  it("explains only automatically generated summaries", () => {
    const render = (summary: string | null) => renderToStaticMarkup(<CouncilWorkPanel steps={[step]} running={false} summary={summary} />);
    const message = "The chair could not write the summary; this list was generated from the steps.";
    expect(render("## Work summary (automatic)\nDetails")).toContain(message);
    expect(render("## Work summary\nDetails")).not.toContain(message);
    expect(render(null)).not.toContain(message);
  });
});
