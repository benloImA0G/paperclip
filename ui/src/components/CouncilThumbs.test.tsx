// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CouncilThumbs } from "./CouncilThumbs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
}

const up = () => container!.querySelector('button[aria-label="This answer helped"]') as HTMLButtonElement;
const down = () => container!.querySelector('button[aria-label="This answer did not help"]') as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("CouncilThumbs", () => {
  it("renders both labelled buttons, unpressed by default", async () => {
    await mount(<CouncilThumbs messageId="m1" onVote={vi.fn()} />);
    expect(up().getAttribute("aria-pressed")).toBe("false");
    expect(down().getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the initial vote", async () => {
    await mount(<CouncilThumbs messageId="m1" initialVote="down" onVote={vi.fn()} />);
    expect(down().getAttribute("aria-pressed")).toBe("true");
    expect(up().getAttribute("aria-pressed")).toBe("false");
  });

  it("votes up and calls onVote", async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    await mount(<CouncilThumbs messageId="m1" onVote={onVote} />);
    await click(up());
    expect(onVote).toHaveBeenCalledWith("up");
    expect(up().getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking the active vote clears it", async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    await mount(<CouncilThumbs messageId="m1" initialVote="up" onVote={onVote} />);
    await click(up());
    expect(onVote).toHaveBeenCalledWith(null);
    expect(up().getAttribute("aria-pressed")).toBe("false");
  });

  it("reverts and shows an error when onVote rejects", async () => {
    const onVote = vi.fn().mockRejectedValue(new Error("boom"));
    await mount(<CouncilThumbs messageId="m1" initialVote="up" onVote={onVote} />);
    await click(down());
    expect(down().getAttribute("aria-pressed")).toBe("false");
    expect(up().getAttribute("aria-pressed")).toBe("true");
    expect(container!.textContent).toContain("Could not save");
  });

  it("disables buttons while saving", async () => {
    let resolve!: () => void;
    const onVote = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    await mount(<CouncilThumbs messageId="m1" onVote={onVote} />);
    await click(up());
    expect(up().disabled).toBe(true);
    expect(down().disabled).toBe(true);
    await act(async () => resolve());
    expect(up().disabled).toBe(false);
  });
});
