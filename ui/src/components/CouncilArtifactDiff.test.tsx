// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouncilArtifactDiff } from "./CouncilArtifactDiff";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(before: string, after: string) { await act(async () => root.render(<CouncilArtifactDiff before={before} after={after} beforeLabel="v1" afterLabel="v2" />)); }
describe("CouncilArtifactDiff", () => {
  it("shows additions and removals accessibly", async () => {
    await render("same\nold", "same\nnew");
    expect(container.textContent).toContain("1 added, 1 removed");
    expect(container.textContent).toContain("Added:");
    expect(container.textContent).toContain("Removed:");
    expect(container.querySelector('section[aria-label="Comparison of v1 and v2"]')).toBeTruthy();
  });
  it("collapses long unchanged runs", async () => {
    const common = Array.from({ length: 7 }, (_, i) => `line ${i}`).join("\n");
    await render(common, `${common}\nnew`);
    expect(container.textContent).toContain("… 7 unchanged lines …");
  });
  it("reports identical text", async () => {
    await render("same", "same");
    expect(container.textContent).toContain("No changes");
  });
  it("limits comparisons to 2000 lines per side", async () => {
    await render(Array(2001).fill("line").join("\n"), "");
    expect(container.textContent).toContain("Too large to compare");
  });
});
