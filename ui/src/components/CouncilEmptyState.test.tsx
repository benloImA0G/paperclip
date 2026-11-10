import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CouncilEmptyState } from "./CouncilEmptyState";

it("shows the steps, prompts and appropriate add action", () => {
  const props = { onAdd: () => {}, onPrompt: () => {} };
  const html = renderToStaticMarkup(<CouncilEmptyState {...props} hasFreeConnection />);
  expect(html).toContain("Add a free team");
  expect(html).toContain("Ask a question");
  expect(html).toContain("Turn the answer into tasks");
  expect(html).toContain("Find the weak points in my plan");
  expect(renderToStaticMarkup(<CouncilEmptyState {...props} hasFreeConnection={false} />)).toContain("Add a seat");
});

it("shows the ready team when three seats are active", () => {
  const html = renderToStaticMarkup(<CouncilEmptyState activeSeatNames={["Alice", "Bob", "Cara"]} hasFreeConnection onAdd={() => {}} onPrompt={() => {}} />);
  expect(html).toContain("Your team is ready: Alice, Bob, Cara");
  expect(html).not.toContain("Add a free team");
});
