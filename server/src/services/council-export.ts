import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const PANDOC_ARGS = ["-f", "markdown-raw_html-raw_attribute-raw_tex+pipe_tables", "--sandbox"];
const MAX_BUFFER = 256 * 1024;
const TIMEOUT_MS = 20_000;
const SERVICE_DIR = fileURLToPath(new URL(".", import.meta.url));
let activeExports = 0;

const SLIDE_CHAR_LIMIT = 700;
const SLIDE_LINE_LIMIT = 12;

type MarkdownBlock = { kind: "table" | "list" | "code" | "paragraph"; lines: string[] };

function isHeading(line: string) {
  return /^(#{1,2})\s+\S/.test(line);
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function blockKind(lines: string[]): MarkdownBlock["kind"] {
  if (lines[0]?.trim().startsWith("```") || lines[0]?.trim().startsWith("~~~")) return "code";
  if (lines.some((line) => /^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(line))) return "list";
  if (lines.length >= 2 && lines[0].includes("|") && isTableSeparator(lines[1])) return "table";
  return "paragraph";
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let current: string[] = [];
  let fenced = false;
  const flush = () => {
    if (current.some((line) => line.trim())) blocks.push({ kind: blockKind(current), lines: current });
    current = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      current.push(line);
      fenced = !fenced;
    } else if (!fenced && !line.trim()) {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function textLength(lines: string[]) {
  return lines.join("\n").length;
}

function splitLines(lines: string[], limit = SLIDE_CHAR_LIMIT): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const line of lines) {
    if (chunk.length && (textLength([...chunk, line]) > limit || chunk.length + 1 > SLIDE_LINE_LIMIT)) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function splitBlock(block: MarkdownBlock): string[][] {
  if (block.kind === "table") {
    const header = block.lines.slice(0, 2);
    const rows = block.lines.slice(2);
    const chunks: string[][] = [];
    for (let i = 0; i < rows.length; i += 7) chunks.push([...header, ...rows.slice(i, i + 7)]);
    return chunks.length ? chunks : [block.lines];
  }
  if (block.kind === "paragraph") {
    const sentences = block.lines.join("\n").split(/(?<=[.!?])\s+(?=[A-Z0-9*])/);
    return splitLines(sentences.flatMap((sentence) => sentence.split("\n")));
  }
  return splitLines(block.lines);
}

/** Split Markdown into Pandoc-friendly PPTX slides without changing DOCX input. */
export function splitForSlides(markdown: string): string {
  const lines = markdown.split("\n");
  const sections: Array<{ heading: string; blocks: MarkdownBlock[] }> = [];
  let heading = "";
  let content: string[] = [];
  let fenced = false;
  const flush = () => {
    if (content.some((line) => line.trim()) || heading) sections.push({ heading, blocks: parseBlocks(content) });
    content = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && isHeading(line)) {
      flush();
      heading = line.replace(/^#{1,2}\s+/, "").trim();
    } else content.push(line);
  }
  flush();
  if (sections[0]?.heading === "") sections[0].heading = "Overview";
  const output: string[] = [];
  for (const section of sections) {
    const chunks: string[][] = [];
    let chunk: string[] = [];
    for (const block of section.blocks) {
      const parts = splitBlock(block);
      for (const part of parts) {
        if (chunk.length && (textLength([...chunk, ...part]) > SLIDE_CHAR_LIMIT || chunk.length + part.length > SLIDE_LINE_LIMIT)) {
          chunks.push(chunk);
          chunk = [];
        }
        chunk.push(...part);
      }
    }
    if (chunk.length || !chunks.length) chunks.push(chunk);
    chunks.forEach((part, index) => {
      output.push(`${index === 0 ? "## " : "## "}${section.heading}${index ? " (cont.)" : ""}`);
      if (part.length) output.push("", part.join("\n"));
    });
  }
  return output.join("\n\n");
}

export class PandocUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super("Pandoc is not installed");
    this.name = "PandocUnavailableError";
  }
}

class ExportCapacityError extends Error {
  readonly status = 503;

  constructor() {
    super("Too many council exports are waiting; please try again shortly");
    this.name = "ExportCapacityError";
  }
}

const slotWaiters: Array<() => void> = [];

function releaseExportSlot() {
  const next = slotWaiters.shift();
  if (next) next();
  else activeExports -= 1;
}

async function acquireExportSlot(): Promise<() => void> {
  if (activeExports < 2) {
    activeExports += 1;
    return releaseExportSlot;
  }
  if (slotWaiters.length >= 4) throw new ExportCapacityError();
  await new Promise<void>((resolve) => slotWaiters.push(resolve));
  return releaseExportSlot;
}

async function convert(title: string, markdown: string, format: "docx" | "pptx"): Promise<Buffer> {
  const release = await acquireExportSlot();
  const directory = await mkdtemp(`${tmpdir()}/paperclip-council-`);
  const output = `${directory}/export.${format}`;
  const args = [...PANDOC_ARGS, "-t", format];
  if (format === "pptx") args.push("--slide-level=2");
  const reference = `${SERVICE_DIR}/council-reference.${format}`;
  try {
    await access(reference);
    args.push("--reference-doc", reference);
  } catch {
    // Development/source checkouts may omit generated reference assets.
  }
  args.push("-M", `title=${title}`, "-M", "subtitle=Council Chat", "-M", `date=${new Date().toISOString().slice(0, 10)}`, "-M", "author=Council Chat", "-o", output);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.PANDOC_PATH || "pandoc", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Pandoc export timed out"));
      }, TIMEOUT_MS);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_BUFFER) stderr += chunk.toString().slice(0, MAX_BUFFER - stderr.length);
      });
      child.stdout.resume();
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") finish(new PandocUnavailableError());
        else finish(error);
      });
      child.on("close", (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(`Pandoc export failed${signal ? ` (${signal})` : ""}: ${stderr.trim() || `exit code ${code}`}`));
      });
      // Never let local file URLs enter Pandoc's resource resolver.
      const safeMarkdown = (format === "pptx" ? splitForSlides(markdown) : markdown)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/!\[([^\]]*)\]\(file:\/\/[^)]*\)/gi, "$1");
      child.stdin.end(safeMarkdown);
    });
    return await readFile(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PandocUnavailableError();
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
    release();
  }
}

export function markdownToDocx(title: string, markdown: string): Promise<Buffer> {
  return convert(title, markdown, "docx");
}

export function markdownToPptx(title: string, markdown: string): Promise<Buffer> {
  return convert(title, markdown, "pptx");
}
