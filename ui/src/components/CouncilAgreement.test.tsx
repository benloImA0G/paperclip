// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { CouncilAgreementMeter } from "./CouncilAgreement";

describe("CouncilAgreementMeter", () => {
  it("shows the label, percent, split, concessions and open objections", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <CouncilAgreementMeter
          round={2}
          agreement={{
            percent: 78,
            label: "Agreement with concessions",
            plain: "4 of 5 seats agree.",
            reached: true,
            counts: { agree: 3, conditions: 1, disagree: 1, abstain: 0 },
            concessions: [{ seat: "Groq", text: "Accept a smaller pilot" }],
            objections: [{ seat: "Gemini", text: "Cost is unknown" }],
          }}
        />,
      );
    });
    const text = host.textContent ?? "";
    expect(text).toContain("Agreement with concessions");
    expect(text).toContain("after discussion 2");
    expect(text).toContain("78%");
    expect(text).toContain("3 agree · 1 agree with conditions · 1 disagree");
    expect(text).toContain("Groq: Accept a smaller pilot");
    expect(text).toContain("Still open");
    expect(text).toContain("Gemini: Cost is unknown");
    act(() => root.unmount());
    host.remove();
  });
});
