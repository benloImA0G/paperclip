import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CouncilSeatProgress } from "./CouncilSeatProgress";

describe("CouncilSeatProgress", () => {
  it("renders accessible waiting and answered indicators", () => {
    expect(renderToStaticMarkup(<CouncilSeatProgress status="waiting" />)).toContain('aria-label="Waiting"');
    expect(renderToStaticMarkup(<CouncilSeatProgress status="waiting" />)).toContain("motion-safe:animate-pulse");
    expect(renderToStaticMarkup(<CouncilSeatProgress status="answered" />)).toContain('aria-label="Answered"');
  });
});
