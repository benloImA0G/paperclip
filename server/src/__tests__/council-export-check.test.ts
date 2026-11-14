import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkExportedFile } from "../services/council-export-check.js";

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc32(raw), 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("checkExportedFile", () => {
  it("accepts a docx with text", () => {
    expect(() => checkExportedFile("docx", zip({ "word/document.xml": "<w:t>Hello</w:t>" }))).not.toThrow();
  });
  it("rejects a docx without text or part", () => {
    expect(() => checkExportedFile("docx", zip({ "word/document.xml": "<w:t></w:t>" }))).toThrow(/no text/);
    expect(() => checkExportedFile("docx", zip({ "other.xml": "x" }))).toThrow(/missing word\/document.xml/);
  });
  it("checks pptx slides", () => {
    expect(() => checkExportedFile("pptx", zip({ "ppt/slides/slide1.xml": "<p/>" }))).not.toThrow();
    expect(() => checkExportedFile("pptx", zip({ "ppt/presentation.xml": "<p/>" }))).toThrow(/no slides/);
  });
  it("checks xlsx sheets", () => {
    expect(() => checkExportedFile("xlsx", zip({ "xl/workbook.xml": '<sheets><sheet name="A"/></sheets>' }))).not.toThrow();
    expect(() => checkExportedFile("xlsx", zip({ "xl/workbook.xml": "<sheets/>" }))).toThrow(/no sheets/);
  });
  it("rejects non-zip and empty input", () => {
    expect(() => checkExportedFile("docx", Buffer.from("not a zip file at all, really not"))).toThrow(/valid zip/);
    expect(() => checkExportedFile("docx", Buffer.alloc(0))).toThrow(/empty/);
  });
});
