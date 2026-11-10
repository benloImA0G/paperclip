import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CouncilReplyFooter } from "./CouncilReplyFooter";

it("renders reported reply details and fallback", () => {
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ councilReliability: { durationMs: 3200, usage: { inputTokens: 1200, outputTokens: 340 }, costCents: "1.23", fallbackUsed: true } }} />);
  expect(html).toContain("3.2 s · 1.2k in / 340 out · $0.0123 · Not fact-checked · fallback model used");
});
