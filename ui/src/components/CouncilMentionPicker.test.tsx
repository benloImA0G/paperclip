// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CouncilMentionPicker, mentionToken, startsWithSeatMention } from "./CouncilMentionPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("seat mentions", () => {
  it("finds the token at the cursor, including in the middle of a message", () => {
    expect(mentionToken("Ask @Te later", 7)).toEqual({ start: 4, end: 7, query: "Te" });
    expect(mentionToken("email@host", 10)).toBeNull();
    expect(mentionToken("@", 1)?.query).toBe("");
  });
  it("recognizes a leading active seat mention without matching a prefix", () => {
    expect(startsWithSeatMention(" @Techie hello", [{ name: "Techie" }])).toBe(true);
    expect(startsWithSeatMention("@TechieExtra hello", [{ name: "Techie" }])).toBe(false);
    expect(startsWithSeatMention("hello @Techie", [{ name: "Techie" }])).toBe(false);
  });
  it("shows selected seats and chooses a clicked seat", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    const choose = vi.fn();
    const seats = [{ id: "1", name: "Techie" }, { id: "2", name: "Friendly" }];
    act(() => root.render(<CouncilMentionPicker seats={seats} selected={1} onChoose={choose} />));
    const options = element.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    act(() => (options[1] as HTMLButtonElement).click());
    expect(choose).toHaveBeenCalledWith(seats[1]);
    act(() => root.unmount());
    element.remove();
  });
});
