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
    expect(text).toContain("1 of 3 steps done");
    expect(text).toContain("Gather facts");
    expect(text).toContain("Gemini");
    expect(text).toContain("Produces: Slide titles");
    expect(text).toContain("Model timed out");
    expect(host.querySelector('[aria-label="Step 2 running"]')).not.toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("renders nothing without steps", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<CouncilWorkPanel running={false} steps={[]} />));
    expect(host.innerHTML).toBe("");
    act(() => root.unmount());
  });
});
