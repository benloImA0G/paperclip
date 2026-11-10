// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CouncilSeat } from "../api/council";
import { CouncilSavedTeams } from "./CouncilSavedTeams";

it("saves a team and creates each missing seat when used", async () => {
  localStorage.clear();
  const seats = ["Alpha", "Beta"].map((name) => ({ name, connectionId: name, grantId: "grant", model: "model", persona: "", role: "none" }) as CouncilSeat);
  const create = vi.fn().mockResolvedValue(undefined);
  const added = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = (current: CouncilSeat[]) => <CouncilSavedTeams seats={current} onCreate={create} onAdded={added} onError={vi.fn()} />;
  await act(async () => root.render(render(seats)));
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Save current"))!.click());
  const input = container.querySelector("input")!;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "My team"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.textContent).toContain("My team");
  await act(async () => root.render(render([])));
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Use")!.click());
  expect(create).toHaveBeenCalledTimes(2);
  expect(added).toHaveBeenCalledWith(2);
  await act(async () => root.unmount()); container.remove();
});

it("closes the teams menu on outside click and Escape", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<CouncilSavedTeams seats={[]} onCreate={vi.fn()} onAdded={vi.fn()} onError={vi.fn()} />));
  const details = container.querySelector("details")!;
  details.open = true;
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(details.open).toBe(false);
  details.open = true;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(container.querySelector("summary"));
  await act(async () => root.unmount()); container.remove();
});
