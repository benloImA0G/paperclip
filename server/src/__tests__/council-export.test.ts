import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { markdownToDocx, markdownToPptx, sanitizeMarkdownForPandoc, splitForSlides } from "../services/council-export.js";

function zipEntries(buffer: Buffer) {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const method = buffer.readUInt16LE(offset + 8);
      const size = buffer.readUInt32LE(offset + 18);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
      const start = offset + 30 + nameLength + extraLength;
      const compressed = buffer.subarray(start, start + size);
      entries.push({ name, data: method === 8 ? inflateRawSync(compressed) : compressed });
      offset = start + size;
    } else if (signature === 0x02014b50 || signature === 0x06054b50) break;
    else offset += 1;
  }
  return entries;
}

const pandocAvailable = (() => {
  try {
    execFileSync(process.env.PANDOC_PATH || "pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!pandocAvailable)("council exports (Pandoc required)", () => {
  const markdown = "# Findings\n\n- **One** result\n- Two\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |";

  it("creates an editable DOCX with headings, lists, and tables", async () => {
    const entries = zipEntries(await markdownToDocx("Council report", markdown));
    const xml = entries.find((entry) => entry.name === "word/document.xml")!.data.toString();
    expect(xml).toMatch(/<w:tbl[ >]/);
    expect(xml).toMatch(/<w:numPr>/);
  });

  it("creates PPTX slides, tables, and bullets without media", async () => {
    const entries = zipEntries(await markdownToPptx("Council report", "## First\n\n- One\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Second\n\n- Two"));
    expect(entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length).toBeGreaterThan(1);
    const xml = entries.map((entry) => entry.data.toString()).join("\n");
    expect(xml).toContain("a:tbl");
    expect(xml).toContain("a:buChar");
    expect(entries.some((entry) => /^ppt\/(media|embeddings)\//.test(entry.name))).toBe(false);
  });

  it("splits a long paragraph across at least three PPTX slides", async () => {
    const paragraph = Array.from({ length: 40 }, (_, index) => `Sentence ${index + 1} explains the council finding.`).join(" ");
    const entries = zipEntries(await markdownToPptx("Council report", `## Findings\n\n${paragraph}`));
    expect(entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length).toBeGreaterThanOrEqual(3);
  });

  it("splits a twelve-row table into two table slides", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => `| ${index + 1} | Value ${index + 1} |`).join("\n");
    const entries = zipEntries(await markdownToPptx("Council report", `## Table\n\n| A | B |\n| --- | --- |\n${rows}`));
    const tableSlides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name) && entry.data.toString().includes("a:tbl"));
    expect(tableSlides).toHaveLength(2);
  });

  it("puts content before the first heading under Overview", async () => {
    const entries = zipEntries(await markdownToPptx("Council report", "Introductory context.\n\n## Details\n\nMore detail."));
    const xml = entries.map((entry) => entry.data.toString()).join("\n");
    expect(xml).toContain("Overview");
  });

  it("does not treat headings inside fenced code as sections", () => {
    const split = splitForSlides("## Example\n\n```md\n## not a heading\n```\n\nText.");
    expect(split).not.toContain("## not a heading (cont.)");
    expect(split).toContain("## Example");
  });

  it("does not read local images or preserve raw script text", async () => {
    const markdown = "# Safe\n\n<script>STEAL_THIS</script>\n\n![x](file:///etc/passwd)";
    const [docx, pptx] = await Promise.all([markdownToDocx("Safe", markdown), markdownToPptx("Safe", markdown)]);
    for (const buffer of [docx, pptx]) {
      const xml = zipEntries(buffer).map((entry) => entry.data.toString()).join("\n");
      expect(xml).not.toContain("STEAL_THIS");
      expect(xml).not.toContain("root:");
      expect(xml).not.toContain("ppt/media/");
    }
  });
});

it("sanitizes remote and local resource references before Pandoc", () => {
  const safe = sanitizeMarkdownForPandoc([
    "![diagram](https://evil.test/a.png)",
    "![local](file:///etc/passwd)",
    '<img src="data:image/png;base64,AAAA">',
    '<iframe src="ftp://evil.test/x"></iframe>',
    '<link rel="stylesheet" href="https://evil.test/x.css">',
  ].join("\n"));
  expect(safe).toContain("diagram");
  expect(safe).toContain("local");
  expect(safe).not.toMatch(/https?:|ftp:|file:|data:/i);
  expect(safe).not.toMatch(/<img|<iframe|<link/i);
});
