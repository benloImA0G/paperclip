// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CouncilSeat } from "../api/council";
import { COUNCIL_ROLE_PRESETS } from "../pages/council-role-presets";
import { VendorSeatCard } from "./VendorSeatCard";

it.each(["draft", "editor"])("applies Reviewer to the %s and leaves fields editable", async (mode) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onActivate = vi.fn();
  const seat = mode === "editor" ? { id: "seat", name: "Test", model: "model", persona: "", role: "none", active: true, fallbacks: [] } as unknown as CouncilSeat : undefined;
  await act(async () => root.render(<VendorSeatCard vendor="Test" color="red" roomId="room" seat={seat} draftDefaults={{ name: "Test", model: "model", persona: "" }} models={["model"]} onActivate={onActivate} onUpdate={onUpdate} />));
  const selects = container.querySelectorAll("select");
  const reviewer = COUNCIL_ROLE_PRESETS.find((preset) => preset.id === "reviewer")!;
  expect(selects[0].options[0].textContent).toBe("Custom");
  expect(selects[0].querySelector('option[value="reviewer"]')?.getAttribute("title")).toBe(reviewer.blurb);
  await act(async () => { selects[0].value = "reviewer"; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.querySelector("textarea")?.value).toBe(reviewer.persona);
  if (seat) expect(onUpdate).toHaveBeenCalledWith({ role: "critic", persona: reviewer.persona });
  else {
    expect(selects[1].value).toBe("critic");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ role: "critic", persona: reviewer.persona }));
  }
  await act(async () => { selects[0].value = ""; selects[0].dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.querySelector("textarea")?.value).toBe(reviewer.persona);
  expect(onUpdate).toHaveBeenCalledTimes(seat ? 1 : 0);
  await act(async () => root.unmount());
  container.remove();
});
