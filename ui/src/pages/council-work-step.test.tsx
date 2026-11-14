import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkStep } from "../api/council";
import { CouncilWorkPanel, CouncilWorkStep, stripTrailingUnbalancedTags } from "./council-work-step";

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
  it("describes running, passed, and rejected work honestly", () => {
    const render = (steps: WorkStep[], running: boolean, status?: "partial") => renderToStaticMarkup(<CouncilWorkPanel steps={steps} running={running} status={status} />);
    expect(render([{ ...step, status: "running" }], true)).toContain("Working: step 3 of 1… (0s)");
    expect(render([{ ...step, grade: "pass" }], false)).toContain("Finished: 1 completed, 1 verified");
    const rejected = render([{ ...step, grade: "fail", gradeNote: "Needs\nmore detail" }], false);
    expect(rejected).toContain("Finished with problems: 0 verified, 1 not completed.");
    expect(rejected).toContain("The checker said: Needs more detail");
    expect(rejected).toContain("You can ask again, or start the work again with a clearer goal.");
    expect(render([step], false, "partial")).toContain("Finished with problems");
  });

  it("removes stray trailing tags while preserving balanced markup", () => {
    expect(stripTrailingUnbalancedTags("Result\n</details>  ")).toBe("Result");
    expect(stripTrailingUnbalancedTags("<details>Result</details>")).toBe("<details>Result</details>");
    expect(stripTrailingUnbalancedTags("Result</div></details>")).toBe("Result");
    expect(stripTrailingUnbalancedTags("Result <details>")).toBe("Result");
    expect(renderToStaticMarkup(<CouncilWorkPanel steps={[step]} running={false} summary="Result</details>" />)).toContain("Result");
  });

});
