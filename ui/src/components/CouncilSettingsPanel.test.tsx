// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CouncilAnswerStyle, CouncilSetting, CouncilSettingsPanel } from "./CouncilSettingsPanel";

it("shows the three groups and descriptions, and selects chain", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn();
  function Example() {
    const [style, setStyle] = useState<"side-by-side" | "chain">("side-by-side");
    return <CouncilSettingsPanel who={<CouncilSetting description="Choose seats.">Seats</CouncilSetting>} how={<CouncilSetting description="Choose how seats answer."><CouncilAnswerStyle value={style} onChange={(value) => { setStyle(value); changed(value); }} /></CouncilSetting>} extras={<CouncilSetting description="Protect exports.">Exports</CouncilSetting>} />;
  }
  await act(async () => root.render(<Example />));
  expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Who answers", "How they talk", "Safety and extras"]);
  for (const description of ["Choose seats.", "Choose how seats answer.", "Protect exports."]) expect(container.textContent).toContain(description);
  const select = container.querySelector("select")!;
  expect(select.value).toBe("side-by-side");
  await act(async () => { select.value = "chain"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(changed).toHaveBeenCalledWith("chain");
  await act(async () => root.unmount());
  container.remove();
});
