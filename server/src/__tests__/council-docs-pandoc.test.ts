import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: mocks.spawn,
}));
import { extractDocTextAsync } from "../services/council-docs.js";

const pandoc = process.env.PANDOC_PATH || "/home/super/.local/bin/pandoc";
const available = spawnSync(pandoc, ["--version"]).status === 0;
const input = { filename: "example.docx", bytes: Buffer.from("input") };

function child() {
  const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("Pandoc document extraction", () => {
  it.skipIf(!available)("extracts a real DOCX", async () => {
    const generated = spawnSync(pandoc, ["--from", "markdown", "--to", "docx"], { input: "# Real document\n\nHello council." });
    expect(generated.status).toBe(0);
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    mocks.spawn.mockImplementation(actual.spawn);
    const result = await extractDocTextAsync({ filename: "real.docx", bytes: generated.stdout, pandocPath: pandoc });
    expect(result.ok && result.text).toContain("Hello council.");
  });

  it("returns a useful reason when Pandoc is missing", async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc);
    const result = extractDocTextAsync(input);
    proc.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await result).toEqual({ ok: false, reason: "Word files need Pandoc on the server" });
  });

  it("kills a conversion on timeout", async () => {
    vi.useFakeTimers();
    const proc = child(); mocks.spawn.mockReturnValue(proc);
    const result = extractDocTextAsync(input);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await result).toEqual({ ok: false, reason: "Document conversion timed out" });
  });

  it("rejects macro-enabled files before spawning", async () => {
    expect(await extractDocTextAsync({ ...input, filename: "test.docm" })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect(await extractDocTextAsync({ ...input, contentType: "application/vnd.ms-word.document.macroEnabled.12" })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("kills a conversion exceeding the output cap", async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc);
    const result = extractDocTextAsync(input);
    proc.stdout.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await result).toEqual({ ok: false, reason: "Converted document exceeds 4 MB" });
  });
});
