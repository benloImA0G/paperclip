// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { CouncilMemoryButton } from "./CouncilMemoryButton";

const mocks = vi.hoisted(() => ({ create: vi.fn(), toast: vi.fn() }));
vi.mock("../api/memory", () => ({ memoryApi: { create: mocks.create } }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: mocks.toast }) }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("saves the reply and offers a link to approve it", async () => {
  mocks.create.mockResolvedValue({});
  await act(async () => root.render(<CouncilMemoryButton companyId="company" issueId="room" roomTitle="Launch" seatName="Alex" body="First sentence. More detail." />));
  await act(async () => container.querySelector("button")!.click());
  expect(mocks.create).toHaveBeenCalledWith("company", expect.objectContaining({ kind: "reference", title: "First sentence.", body: "First sentence. More detail.", originKind: "council", originRef: "room", createdByLabel: "Alex", sourceLabel: "Council: Launch" }));
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved - waiting for your approval in Memory", action: expect.objectContaining({ href: "/memory" }) }));
});
it("reports a duplicate", async () => {
  mocks.create.mockRejectedValue(new ApiError("duplicate", 409, {}));
  await act(async () => root.render(<CouncilMemoryButton companyId="company" issueId="room" roomTitle="Launch" seatName="Chair" body="Decision." decision />));
  await act(async () => container.querySelector("button")!.click());
  expect(mocks.create).toHaveBeenCalledWith("company", expect.objectContaining({ kind: "decision" }));
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Already in Memory" }));
});
