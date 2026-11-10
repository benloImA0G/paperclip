// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CouncilStyleSwitch, type CouncilQuickStyle } from "./CouncilStyleSwitch";

it("shows the current style and selects another", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn();
  function Example() {
    const [value, setValue] = useState<CouncilQuickStyle>("collaborate");
    return <CouncilStyleSwitch value={value} onChange={(next) => { setValue(next); changed(next); }} />;
  }
  await act(async () => root.render(<Example />));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.map((button) => button.textContent)).toEqual(["Work together", "Challenge each other", "One after another"]);
  expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  await act(async () => buttons[2].click());
  expect(changed).toHaveBeenCalledWith("chain");
  expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
  expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
  await act(async () => root.unmount());
  container.remove();
});
