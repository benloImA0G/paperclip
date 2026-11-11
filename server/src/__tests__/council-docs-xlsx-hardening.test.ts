import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { safeXlsxInline } from "../services/council-docs.js";

function archive(sheets: string[]): Buffer {
  const locals: Buffer[] = [], entries: Buffer[] = [];
  let offset = 0;
  sheets.forEach((xml, index) => {
    const name = Buffer.from(`xl/worksheets/sheet${index + 1}.xml`);
    const data = deflateRawSync(Buffer.from(xml));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(Buffer.byteLength(xml), 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(Buffer.byteLength(xml), 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, data); entries.push(entry, name);
    offset += local.length + name.length + data.length;
  });
  const directory = Buffer.concat(entries), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(sheets.length, 8); end.writeUInt16LE(sheets.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const cell = (value: string) => `<c r="A1" t="inlineStr"><is><t>${value}</t></is></c>`;

describe("XLSX inline recovery limits", () => {
  it("scans unmatched cells in under one second", async () => {
    const zip = archive(["<c ".repeat(200_000)]);
    const start = performance.now();
    expect(await safeXlsxInline(zip)).toBe("");
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it("processes at most twenty worksheets", async () => {
    const result = await safeXlsxInline(archive(Array.from({ length: 30 }, (_, i) => cell(`value${i + 1}`))));
    expect(result).toContain("value20");
    expect(result).not.toContain("value21");
    expect(result.split("\n")).toHaveLength(20);
  });
  it("bounds actual cumulative inflated bytes and skips oversized sheets", async () => {
    const first = cell("first"), large = cell("x".repeat(100)), last = cell("last");
    const result = await safeXlsxInline(archive([first, large, last]), Buffer.byteLength(first + last));
    expect(result).toContain("first"); expect(result).toContain("last"); expect(result).not.toContain("xxxx");
  });
  it("decodes entities and strips control characters", async () => {
    const result = await safeXlsxInline(archive([cell("A\x01&amp;&#x2;B\nC")]));
    expect(result).toContain("A&B\nC");
  });
  it("never throws for a truncated or hostile central directory", async () => {
    const zip = archive([cell("test")]);
    const end = zip.length - 22;
    zip.writeUInt32LE(end - 2, end + 16);
    expect(await safeXlsxInline(zip)).toBe("");
    expect(await safeXlsxInline(Buffer.alloc(3))).toBe("");
  });
});
