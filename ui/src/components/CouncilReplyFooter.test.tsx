import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CouncilReplyFooter } from "./CouncilReplyFooter";

it("shows measured values and keeps missing details in the title", () => {
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ councilReliability: { durationMs: 4200, usage: { inputTokens: 1200 }, costCents: 0.2 } }} />);
  expect(html).toContain("4.2s · 1.2k in · $0.002 · Not fact-checked");
  expect(html).toContain("First-token time is not measured yet");
  expect(html).toContain("Output tokens unavailable");
});

it("shows local cost and supports old replies", () => {
  expect(renderToStaticMarkup(<CouncilReplyFooter metadata={{ councilReliability: { local: true, costCents: 3, usage: { outputTokens: 0 } } }} />)).toContain("0 out · FREE (Local) · Not fact-checked");
  expect(renderToStaticMarkup(<CouncilReplyFooter />)).toContain("This vendor did not report a price.");
  expect(renderToStaticMarkup(<CouncilReplyFooter />)).toMatch(/>Not fact-checked<\/div>/);
});

it("identifies answers from a backup model", () => {
  expect(renderToStaticMarkup(<CouncilReplyFooter metadata={{ councilReliability: { fallbackUsed: true } }} />)).toContain("answered by a backup model");
  expect(renderToStaticMarkup(<CouncilReplyFooter />)).not.toContain("answered by a backup model");
});
