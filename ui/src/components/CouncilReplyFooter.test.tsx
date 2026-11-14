import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CouncilReplyFooter, displayCouncilCitations } from "./CouncilReplyFooter";

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

it("shows reference documents and lists all names in the title", () => {
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ documents: ["brief.md", "notes.csv"] }} />);
  expect(html).toContain('title="brief.md, notes.csv">Read: brief.md, notes.csv');
});

it("collapses reference documents after three names", () => {
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ documents: ["a.md", "b.md", "c.md", "d.md", "e.md"] }} />);
  expect(html).toContain('title="a.md, b.md, c.md, d.md, e.md">Read: a.md, b.md, c.md +2 more');
});

it("hides reference documents when absent or empty", () => {
  expect(renderToStaticMarkup(<CouncilReplyFooter />)).not.toContain("Read:");
  expect(renderToStaticMarkup(<CouncilReplyFooter metadata={{ documents: [] }} />)).not.toContain("Read:");
});

it("reads documents from persisted reliability metadata", () => {
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ councilReliability: { documents: ["notes.md"] } }} />);
  expect(html).toContain("Read: notes.md");
});

it("maps known citation markers without changing unknown markers", () => {
  expect(displayCouncilCitations("See [d1#1], [d2#3], [d3#1] and [d0#1].", ["brief.md", "notes.csv"]))
    .toBe("See `brief.md`, `notes.csv`, [d3#1] and [d0#1].");
});


it("leaves citations inside fenced and inline code unchanged", () => {
  const text = "Before [d1#1] and `[d1#1]`.\n```md\n[d1#1]\n```\nAfter [d1#1].";
  expect(displayCouncilCitations(text, ["brief.md"]))
    .toBe("Before `brief.md` and `[d1#1]`.\n```md\n[d1#1]\n```\nAfter `brief.md`.");
});

it("renders persisted jury and ranking as separate notices", () => {
  const evaluation = { jury: { answerSeat: "A", verdict: "revise", judges: 1, eligible: 2, counts: { pass: 0, revise: 1, fail: 0 } }, ranking: { judges: 2, eligible: 3, order: [{ seatName: "A" }, { seatName: "B" }] } };
  const html = renderToStaticMarkup(<CouncilReplyFooter metadata={{ sections: [{ title: "Council evaluation", rows: [{ type: "text", text: JSON.stringify(evaluation) }] }] }} />);
  expect(html).toContain("Jury:");
  expect(html).toContain("REVISE");
  expect(html).toContain("Blind peer ranking:");
  expect(html).toContain("1. A, 2. B");
  expect(html).toContain("1/2 judges");
  expect(html).toContain("2/3 judges");
});
