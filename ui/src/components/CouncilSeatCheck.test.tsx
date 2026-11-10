// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { councilApi } from "../api/council";
import { CouncilSeatCheck } from "./CouncilSeatCheck";

it("disables during a check and displays and dismisses seat results", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof councilApi.checkSeats>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof councilApi.checkSeats>>>((done) => { resolve = done; });
  const check = vi.spyOn(councilApi, "checkSeats").mockReturnValue(pending);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<CouncilSeatCheck companyId="company" roomId="room" onError={vi.fn()} />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(container.textContent).toContain("Checking…");
  expect(check).toHaveBeenCalledWith("company", "room");
  await act(async () => resolve({ results: [
    { seatId: "1", seatName: "Alpha", model: "a", ok: true, status: "ok", durationMs: 1300 },
    { seatId: "2", seatName: "Beta", model: "b", ok: false, status: "error", durationMs: 200, error: "Check the connection." },
  ] }));
  expect(container.textContent).toContain("Alpha: Works · 1.3s");
  expect(container.textContent).toContain("Beta: Needs attention: Check the connection.");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss seat check results"]')!.click());
  expect(container.textContent).not.toContain("Alpha");
  await act(async () => root.unmount());
  container.remove();
  check.mockRestore();
});
