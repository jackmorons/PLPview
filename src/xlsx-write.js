// Workbook description (export.js) → .xlsx bytes, with ExcelJS: bold headers, frozen first row,
// yellow input cells, dropdowns and cell comments, which SheetJS's free edition can't write.
// The app loads this file only when it exports (import("./xlsx-write.js")), so ExcelJS (~1 MB) stays out of
// the startup bundle. Also used in Node by scripts/make-templates.js and the tests. No DOM, no Capacitor.
import ExcelJS from "exceljs";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
const INPUT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };

/**
 * description: {sheets: [{name, cols: [width], freeze, rows: [[cell]], notes: {A1: text}, validations: [{range, list, strict}]}]}
 * cell: null | string | number | {v, f, bold, header, input}; {v: null, input: true} is an empty yellow cell
 * Returns a Uint8Array.
 */
export async function writeWorkbook(description) {
  const wb = new ExcelJS.Workbook();
  for (const s of description.sheets) {
    const ws = wb.addWorksheet(s.name, s.freeze ? { views: [{ state: "frozen", ySplit: s.freeze }] } : {});
    ws.columns = (s.cols || []).map((width) => ({ width }));
    s.rows.forEach((row, ri) => {
      row.forEach((c, ci) => {
        if (c == null || c === "") return;
        const cell = ws.getCell(ri + 1, ci + 1);
        if (typeof c !== "object") { cell.value = c; return; }
        if (c.f) cell.value = { formula: c.f, result: c.v };
        else if (c.v != null && c.v !== "") cell.value = c.v;
        if (c.bold || c.header) cell.font = { bold: true };
        if (c.header) cell.fill = HEADER_FILL;
        if (c.input) cell.fill = INPUT_FILL;
      });
    });
    for (const [ref, text] of Object.entries(s.notes || {})) ws.getCell(ref).note = text;
    for (const v of s.validations || []) {
      ws.dataValidations.add(v.range, {
        type: "list", allowBlank: true, formulae: [`"${v.list}"`],
        // Not strict: the dropdown only suggests, any value can be typed.
        showErrorMessage: v.strict, errorStyle: "stop", errorTitle: "Valore non ammesso", error: `Usa uno di: ${v.list.replace(/,/g, ", ")}`,
      });
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
