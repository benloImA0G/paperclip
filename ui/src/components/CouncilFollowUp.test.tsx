import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CouncilFollowUpView } from "./CouncilFollowUp";

it("shows the empty state", () => {
  const html = renderToStaticMarkup(<CouncilFollowUpView data={{ summary: { total: 0, done: 0, blocked: 0, inProgress: 0, open: 0 }, headline: "No tasks from this room yet", items: [] }} />);
  expect(html).toContain("No tasks from this room yet");
});

it("shows headline, rows, outcome and stale note", () => {
  const html = renderToStaticMarkup(<CouncilFollowUpView data={{
    summary: { total: 2, done: 1, blocked: 1, inProgress: 0, open: 0 },
    headline: "1 of 2 done, 1 blocked",
    items: [
      { id: "1", identifier: "PAP-1", title: "Ship it", status: "done", assigneeName: "Ada", updatedAt: "2026-11-13T00:00:00Z", outcome: "All shipped", stale: false, staleDays: 0 },
      { id: "2", identifier: "PAP-2", title: "Wait on API", status: "in_progress", assigneeName: null, updatedAt: "2026-11-01T00:00:00Z", outcome: null, stale: true, staleDays: 12 },
    ],
  }} />);
  expect(html).toContain("1 of 2 done, 1 blocked");
  expect(html).toContain("PAP-1");
  expect(html).toContain("Ada");
  expect(html).toContain("All shipped");
  expect(html).toContain("in progress");
  expect(html).toContain("Unassigned");
  expect(html).toContain("No update for 12 days");
});
