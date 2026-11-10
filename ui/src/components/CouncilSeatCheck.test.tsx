// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { councilApi } from "../api/council";
import { lastCheck } from "../pages/council-check-memory";
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
  expect(container.textContent).toContain("1 of 2 seats fully work, 0 only through a backup, 1 needs attention");
  expect(container.textContent).toContain("Alpha: Works · 1.3s");
  expect(container.textContent).toContain("Beta: Needs attention: Check the connection.");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss seat check results"]')!.click());
  expect(container.textContent).not.toContain("Alpha");
  expect(lastCheck("room")?.seats).toEqual({ "1": { ok: true, seconds: 1.3 }, "2": { ok: false, error: "Check the connection.", seconds: 0.2 } });
  await act(async () => root.unmount());
  container.remove();
  check.mockRestore();
});

it("distinguishes backup and status-only agent checks", async () => {
  const check = vi.spyOn(councilApi, "checkSeats").mockResolvedValue({ results: [
    { seatId: "1", seatName: "Alpha", model: "a", ok: true, status: "ok", durationMs: 100, backupUsed: true, primaryError: "Unavailable" },
    { seatId: "2", seatName: "Agent", model: null, ok: true, status: "ok", durationMs: 0, agentSeat: true },
  ] } as unknown as Awaited<ReturnType<typeof councilApi.checkSeats>>);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<CouncilSeatCheck companyId="company" roomId="backup-room" onError={vi.fn()} />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("1 of 2 seats fully work, 1 only through a backup, 0 needs attention");
  expect(container.textContent).toContain("Works, but only through a backup model. Main model: Unavailable");
  expect(container.textContent).toContain("Agent is ready (status checked, not contacted)");
  expect(lastCheck("backup-room")?.seats["1"]).toMatchObject({ backupUsed: true, primaryError: "Unavailable" });
  expect(lastCheck("backup-room")?.seats["2"]).toMatchObject({ agentSeat: true });
  await act(async () => root.unmount());
  check.mockRestore();
});
