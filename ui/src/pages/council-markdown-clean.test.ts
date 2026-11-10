import { expect, it } from "vitest";
import { cleanMarkdownForDisplay } from "./council-markdown-clean";

it("cleans breaks in tables and prose while preserving fenced code", () => {
  expect(cleanMarkdownForDisplay("| a<br>b<br/>c<br />d |\nhello<br>world\n```html\n| <br> |\n```\n~~~\n<br/>\n~~~")).toBe("| a b c d |\nhello\nworld\n```html\n| <br> |\n```\n~~~\n<br/>\n~~~");
});
