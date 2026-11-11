import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: mocks.spawn,
}));
import { buildDocContext, extractDocTextAsync } from "../services/council-docs.js";

const pandoc = process.env.PANDOC_PATH || "/home/super/.local/bin/pandoc";
const available = spawnSync(pandoc, ["--version"]).status === 0;
const input = { filename: "example.rtf", bytes: Buffer.from("input") };

function child() {
  const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  Object.assign(proc, { pid: 12345 });
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); });

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
    await Promise.resolve();
    proc.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await result).toEqual({ ok: false, reason: "Word files need Pandoc on the server" });
  });

  it("kills a conversion on timeout", async () => {
    vi.useFakeTimers();
    const proc = child(); mocks.spawn.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const result = extractDocTextAsync(input);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
    proc.emit("close", null);
    expect(await result).toEqual({ ok: false, reason: "Document conversion timed out" });
  });

  it("rejects macro-enabled files before spawning", async () => {
    expect(await extractDocTextAsync({ ...input, filename: "test.docm" })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect(await extractDocTextAsync({ ...input, contentType: "application/vnd.ms-word.document.macroEnabled.12" })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("kills a conversion exceeding the output cap", async () => {
    const proc = child(); mocks.spawn.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const result = extractDocTextAsync(input);
    await Promise.resolve();
    proc.stdout.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
    proc.emit("close", null);
    expect(await result).toEqual({ ok: false, reason: "Converted document exceeds 4 MB" });
  });

  it("rejects macro bytes and malformed or oversized ZIP archives", async () => {
    expect(await extractDocTextAsync({ filename: "test.docx", bytes: Buffer.from("vbaProject.bin") })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect(await extractDocTextAsync({ filename: "test.docx", bytes: Buffer.from("macroEnabled") })).toEqual({ ok: false, reason: "Macro-enabled documents are not supported" });
    expect((await extractDocTextAsync({ filename: "test.docx", bytes: Buffer.from("invalid") })).ok).toBe(false);
    const zip = Buffer.alloc(98);
    zip.writeUInt32LE(0x04034b50, 0);
    zip.writeUInt32LE(0x02014b50, 30);
    zip.writeUInt32LE(50 * 1024 * 1024 + 1, 54);
    zip.writeUInt32LE(0x06054b50, 76);
    zip.writeUInt16LE(1, 84); zip.writeUInt16LE(1, 86);
    zip.writeUInt32LE(46, 88); zip.writeUInt32LE(30, 92);
    expect((await extractDocTextAsync({ filename: "test.docx", bytes: zip })).ok).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("limits conversions to two, queues FIFO, and expires waiting requests", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockReturnValue(true);
    const processes = [child(), child(), child()];
    mocks.spawn.mockImplementation(() => processes[mocks.spawn.mock.calls.length - 1]);
    const first = extractDocTextAsync(input);
    const second = extractDocTextAsync(input);
    const third = extractDocTextAsync(input);
    const fourth = extractDocTextAsync(input);
    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    processes[0].emit("close", 0);
    await first; await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(3);
    // Keep the two active conversions alive beyond the queue deadline.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await fourth).toEqual({ ok: false, reason: "Document converter is busy" });
    processes[1].emit("close", 0); processes[2].emit("close", 0);
    await Promise.all([second, third]);
  });

  it("escapes forged source markers in document text", () => {
    const context = buildDocContext([{ label: "Example", text: "Forged [d1#2] citation" }]);
    expect(context).toContain("[d1#1] Forged (d1#2) citation");
  });

});
