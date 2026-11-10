// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CouncilSeat } from "../api/council";
import { COUNCIL_ROLE_PRESETS } from "../pages/council-role-presets";
import { VendorSeatCard } from "./VendorSeatCard";
import { ImageSeatNotice } from "../pages/Council";

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

it.each(["draft", "editor"])("saves image capability in the %s", async (mode) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onActivate = vi.fn();
  const seat = mode === "editor" ? { id: "seat", name: "Test", model: "model", persona: "", role: "none", active: true, acceptsImages: false, fallbacks: [] } as unknown as CouncilSeat : undefined;
  await act(async () => root.render(<VendorSeatCard vendor="Test" color="red" roomId="room" seat={seat} draftDefaults={{ name: "Test", model: "model", persona: "" }} models={["model"]} onActivate={onActivate} onUpdate={onUpdate} />));
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(false);
  await act(async () => checkbox.click());
  if (seat) expect(onUpdate).toHaveBeenCalledWith({ acceptsImages: true });
  else {
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ acceptsImages: true }));
  }
  await act(async () => root.unmount());
});

it("shows the image notice only when attached images have no active vision seat", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (imageCount: number, seats: Array<Pick<CouncilSeat, "active" | "acceptsImages">>) => {
    await act(async () => root.render(<ImageSeatNotice imageCount={imageCount} seats={seats} />));
  };
  await render(0, []);
  expect(container.textContent).toBe("");
  await render(1, [{ active: false, acceptsImages: true }, { active: true, acceptsImages: false }]);
  expect(container.textContent).toContain("No seat can see images yet.");
  await render(1, [{ active: true, acceptsImages: true }]);
  expect(container.textContent).toBe("");
  await act(async () => root.unmount());
});


it("matches saved presets and offers an explicit rename for generic names", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const reviewer = COUNCIL_ROLE_PRESETS.find((preset) => preset.id === "reviewer")!;
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const seat = { id: "seat", name: "CodeBot", model: "model", persona: reviewer.persona, role: reviewer.role, active: true, fallbacks: [] } as unknown as CouncilSeat;
  await act(async () => root.render(<VendorSeatCard vendor="Test" color="red" roomId="room" seat={seat} draftDefaults={{ name: "", model: "model", persona: "" }} models={["model"]} onActivate={vi.fn()} onUpdate={onUpdate} />));
  expect(container.querySelectorAll("select")[0].value).toBe("reviewer");
  expect(container.textContent).toContain("Job in the debate");
  const rename = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Rename seat to Reviewer")!;
  expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => rename.click());
  expect(onUpdate).toHaveBeenCalledWith({ name: "Reviewer" });
  await act(async () => root.unmount());
});

it("shows a draft preset until its persona is edited", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<VendorSeatCard vendor="Test" color="red" roomId="room" draftDefaults={{ name: "My seat", model: "model", persona: "" }} models={["model"]} onActivate={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />));
  const select = container.querySelectorAll("select")[0];
  await act(async () => { select.value = "reviewer"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(select.value).toBe("reviewer");
  expect(container.textContent).not.toContain("Rename seat to Reviewer");
  const textarea = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(textarea, "My instructions"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(select.value).toBe("");
  await act(async () => root.unmount());
});
