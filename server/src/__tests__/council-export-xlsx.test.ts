import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { markdownToXlsx } from "../services/council-export.js";
import { checkExportedFile } from "../services/council-export-check.js";

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return wb;
}

describe("markdownToXlsx", () => {
  it("makes one sheet per table with bold headers", async () => {
    const md = "## Costs\n\n| Item | Price |\n|---|---|\n| Tea | 3 |\n\n## Risks: [big]\n\n| Risk | Level |\n|---|---|\n| Fire | High |\n";
    const buffer = await markdownToXlsx(md, "Plan");
    expect(() => checkExportedFile("xlsx", buffer)).not.toThrow();
    const wb = await load(buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Costs", "Risks big"]);
    expect(wb.getWorksheet("Costs")!.getRow(1).font?.bold).toBe(true);
    expect(wb.getWorksheet("Costs")!.getRow(2).getCell(1).value).toBe("Tea");
  });

  it("guards formula injection", async () => {
    const buffer = await markdownToXlsx("| A |\n|---|\n| =SUM(1,2) |\n| @cmd |\n", "T");
    const sheet = (await load(buffer)).worksheets[0];
    expect(sheet.getRow(2).getCell(1).value).toBe("'=SUM(1,2)");
    expect(sheet.getRow(3).getCell(1).value).toBe("'@cmd");
  });

  it("uses a Notes sheet when there is no table", async () => {
    const buffer = await markdownToXlsx("Hello\n\nWorld", "T");
    const wb = await load(buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Notes"]);
    expect(wb.worksheets[0].rowCount).toBe(2);
  });
});
