// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouncilEstimate } from "./CouncilEstimate";

const councilApi = vi.hoisted(() => ({ listSeats: vi.fn(), getEstimate: vi.fn() }));
vi.mock("../api/council", () => ({ councilApi }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

const estimate = (overrides = {}) => ({
  mode: "ask", label: "estimate", calls: 4, estimatedCostCents: { low: 2, high: 8 }, unpricedSeats: 0,
  estimatedSeconds: { low: 5, high: 45 }, seats: [{ seatId: "seat-1", label: "Ada", kind: "model", calls: 4, estimatedCostCents: 8, basis: "history" }], ...overrides,
});

async function render() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><CouncilEstimate roomId="room-1" mode="ask" time={{ low: 5, high: 45 }} /></QueryClientProvider>));
}

async function settle() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  councilApi.listSeats.mockResolvedValue([{ id: "seat-1" }]);
  councilApi.getEstimate.mockResolvedValue(estimate());
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

describe("CouncilEstimate", () => {
  it("formats cost and time estimates", async () => {
    await render();
    await settle();
    expect(container.textContent).toContain("Estimate: about 4 calls, roughly $0.02-$0.08, about 5 s to 45 s");
    expect(container.querySelector("span")?.title).toContain("Ada: 4 calls");
  });

  it("shows unknown cost and singular unpriced seat", async () => {
    councilApi.getEstimate.mockResolvedValue(estimate({ estimatedCostCents: null, unpricedSeats: 1, seats: [] }));
    await render();
    await settle();
    expect(container.textContent).toContain("cost unknown (no price history)");
    expect(container.textContent).toContain("(1 seat unpriced)");
  });

  it("formats costs below one cent", async () => {
    councilApi.getEstimate.mockResolvedValue(estimate({ estimatedCostCents: { low: 0, high: 1 } }));
    await render();
    await settle();
    expect(container.textContent).toContain("roughly <$0.01-$0.01");
  });

  it("renders nothing when the estimate fails", async () => {
    councilApi.getEstimate.mockRejectedValue(new Error("unavailable"));
    await render();
    await settle();
    expect(container.textContent).toBe("");
  });
});

