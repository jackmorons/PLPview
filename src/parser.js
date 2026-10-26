// xlsx → program model (schema 2, docs/PROGRAM-SCHEMA.md). Two formats are accepted:
//   - PL28 format (docs/FORMAT.md): has an `accessori` sheet → parse-pl28.js
//   - coach format (docs/FORMAT-COACH.md): has a `training log…` sheet → parse-coach.js
// The result is either a complete model or the full list of errors, never a half-read program.
// Called by library.js with the file's bytes. Pure: no DOM, no Capacitor, so Vitest runs it in Node.
import * as XLSX from "xlsx";
import { parsePL28 } from "./parse-pl28.js";
import { parseCoach } from "./parse-coach.js";
import { cellText, getCell, findSheet, duplicateSheets } from "./parse-common.js";

export { parseFormula } from "./parse-common.js";
// 1: files without a meta sheet. 2 (2026-10-26): the `overall` layout shared by both formats; what the app writes.
// The parser reads both: version 2 only marks files an older app couldn't read.
export const FORMAT_VERSION = 2;
const SHEETS = ["Massimali", "overall", "accessori", "note", "meta"];

/** Parses an .xlsx file (ArrayBuffer or Uint8Array). Returns {ok, model, errors, warnings}. */
export function parseXlsx(bytes) {
  let wb;
  try {
    wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  } catch {
    return { ok: false, model: null, errors: [{ ref: "file", msg: "non è un file xlsx leggibile" }], warnings: [] };
  }
  return parseWorkbook(wb);
}

/** Same as parseXlsx, for a workbook SheetJS has already read (with cellFormula: true). */
export function parseWorkbook(wb) {
  const errors = [];
  const warnings = [];
  // Report each cell once, even when two checks both find it.
  const err = (ref, msg) => { if (!errors.some((e) => e.ref === ref)) errors.push({ ref, msg }); };

  // Format version: no `meta` sheet means format 1 (VERSIONS.md → Foundations).
  const meta = findSheet(wb, "meta");
  const v = meta && getCell(meta, 1, 2)?.v;
  if (meta && cellText(getCell(meta, 1, 1)).toLowerCase() === "formatversion" && typeof v === "number" && v > FORMAT_VERSION) {
    return fail([{ ref: "meta!B1", msg: `formato ${v} non supportato da questa versione dell'app (massimo ${FORMAT_VERSION}): aggiorna l'app` }], warnings);
  }

  // Sheet names ignore capitals, so "note" and "Note" together would be ambiguous.
  for (const names of duplicateSheets(wb, SHEETS)) for (const s of names) err(s, `fogli con lo stesso nome (${names.join(", ")}): ne serve uno solo`);
  if (errors.length) return fail(errors, warnings);

  // Which format? `accessori` wins: PL28.xlsx also carries an athlete's `training log` sheet, which that format ignores.
  const logs = wb.SheetNames.filter((s) => s.trim().toLowerCase().startsWith("training log"));
  let model = null;
  if (findSheet(wb, "accessori")) {
    model = parsePL28(wb, err);
  } else if (logs.length > 1) {
    for (const s of logs) err(s, `c'è più di un foglio "training log…" (${logs.join(", ")}): ne serve uno solo`);
  } else if (logs.length === 1) {
    model = parseCoach(wb, logs[0], err, warnings);
  } else {
    err("file", 'formato non riconosciuto: serve un foglio "accessori" (formato PL28) o un foglio "training log" (formato coach)');
  }

  return errors.length || !model ? fail(errors, warnings) : { ok: true, model, errors: [], warnings };
}

/** "overall!D7: formula non riconosciuta" — the line shown on the import errors screen. */
export function formatIssue(e) {
  return `${e.ref}: ${e.msg}`;
}

function fail(errors, warnings) {
  return { ok: false, model: null, errors, warnings };
}
