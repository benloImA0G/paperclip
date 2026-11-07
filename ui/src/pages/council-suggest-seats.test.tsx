// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { councilApi } from "../api/council";
import { CouncilSuggestSeats } from "./council-suggest-seats";

vi.mock("../api/council", () => ({ councilApi: { suggestSeats: vi.fn() } }));
const suggestSeats = vi.mocked(councilApi.suggestSeats);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  act(() => button.click());
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
function render(onAdd = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CouncilSuggestSeats companyId="company" roomId="room" onAdd={onAdd} />));
  return onAdd;
}
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); });

describe("CouncilSuggestSeats", () => {
  it("suggests seats, adds a proposal, and shuffles with a new seed", async () => {
    const proposal = { connectionId: "conn", vendor: "Vendor", model: "model-1", name: "Advisor" };
    suggestSeats.mockResolvedValue({ proposals: [proposal] });
    const onAdd = render();
    click("Suggest seats");
    click("Suggest");
    await flush();
    expect(suggestSeats).toHaveBeenCalledWith("company", "room", { count: 3, seed: expect.any(Number) });
    expect(container.textContent).toContain("Vendor · model-1");
    click("Add");
    expect(onAdd).toHaveBeenCalledWith(proposal);
    click("Shuffle");
    await flush();
    expect(suggestSeats.mock.calls[1][2].seed).not.toBe(suggestSeats.mock.calls[0][2].seed);
  });
  it("shows an empty state", async () => {
    suggestSeats.mockResolvedValue({ proposals: [] });
    render();
    click("Suggest seats");
    click("Suggest");
    await flush();
    expect(container.textContent).toContain("No seats can be suggested.");
  });
});
