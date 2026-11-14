// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CouncilWorkPanel } from "./CouncilWorkPanel";

describe("CouncilWorkPanel", () => {
  it("lists steps with assignee, status and progress", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <CouncilWorkPanel
          running
          steps={[
            { n: 1, title: "Gather facts", expected: "A fact list", assignee: "Groq", status: "done" },
            { n: 2, title: "Draft deck outline", expected: "Slide titles", assignee: "Gemini", status: "running" },
            { n: 3, title: "Final review", expected: "Approved summary", assignee: "Chair", status: "failed", error: "Model timed out" },
          ]}
        />,
      );
    });
    const text = host.textContent ?? "";
    expect(text).toContain("Working: step 2 of 3… (0s)");
    expect(text).toContain("Gather facts");
    expect(text).toContain("Gemini");
    expect(text).toContain("Produces: Slide titles");
    expect(text).toContain("Model timed out");
    expect(host.querySelector('[aria-label="Step 2 running"]')).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("distinguishes unavailable checks and blocked work", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<CouncilWorkPanel running={false} steps={[
      { n: 1, title: "Draft", expected: "x", assignee: "Chair", status: "done", verification: "check_unavailable" },
      { n: 2, title: "Finish", expected: "x", assignee: "Chair", status: "failed", error: "Blocked by step 1", blockedBy: 1 },
    ] as Parameters<typeof CouncilWorkPanel>[0]["steps"]} />));
    expect(host.textContent).toContain("Completed, check unavailable");
    expect(host.textContent).toContain("Blocked by step 1");
    expect(host.textContent).toContain("0 verified, 1 not completed");
    act(() => root.unmount());
  });

  it("renders nothing without steps", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<CouncilWorkPanel running={false} steps={[]} />));
    expect(host.innerHTML).toBe("");
    act(() => root.unmount());
  });
});
