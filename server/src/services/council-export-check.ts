import { inflateRawSync } from "node:zlib";

export type ExportFormat = "docx" | "pptx" | "xlsx";

export class ExportCheckError extends Error {
  readonly status = 502;

  constructor(message: string) {
    super(`Council export failed its file check: ${message}`);
    this.name = "ExportCheckError";
  }
}

const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

/** Minimal zip reader (central directory + deflate/stored); avoids adding a dependency. */
function readZipEntries(buffer: Buffer): Map<string, () => Buffer> {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - minEocd - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExportCheckError("not a valid zip archive");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ExportCheckError("corrupt zip directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.set(name, () => {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ExportCheckError(`corrupt entry ${name}`);
      const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const data = buffer.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
        } catch {
          throw new ExportCheckError(`cannot decompress ${name}`);
        }
      }
      throw new ExportCheckError(`unsupported compression in ${name}`);
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Throws ExportCheckError (status 502) when the file does not open or lacks the expected parts. */
export function checkExportedFile(format: ExportFormat, buffer: Buffer): void {
  if (!buffer || buffer.length < 22) throw new ExportCheckError("file is empty");
  const entries = readZipEntries(buffer);
  const read = (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new ExportCheckError(`missing ${name}`);
    return entry().toString("utf8");
  };
  if (format === "docx") {
    const text = [...read("word/document.xml").matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").trim();
    if (!text) throw new ExportCheckError("document has no text");
  } else if (format === "pptx") {
    const slides = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    if (!slides.length) throw new ExportCheckError("presentation has no slides");
    slides.forEach((name) => read(name));
  } else {
    const sheets = read("xl/workbook.xml").match(/<sheet\s/g)?.length ?? 0;
    if (!sheets) throw new ExportCheckError("workbook has no sheets");
  }
}
