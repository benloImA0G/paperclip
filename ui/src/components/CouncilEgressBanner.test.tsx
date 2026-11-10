import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CouncilEgressBanner } from "./CouncilEgressBanner";

it("shows cloud routing only when known", () => {
  expect(renderToStaticMarkup(<CouncilEgressBanner local={false} provider="Example" />)).toContain("Prompts for this seat may be sent to a cloud provider (Example).");
  expect(renderToStaticMarkup(<CouncilEgressBanner local />)).toBe("");
  expect(renderToStaticMarkup(<CouncilEgressBanner />)).toBe("");
});
