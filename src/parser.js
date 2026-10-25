// xlsx → program model (docs/FORMAT.md is the contract, docs/PROGRAM-SCHEMA.md the output).
// Called by the import flow with the file's bytes; the result is either a complete model or a full
// list of errors, never a half-parsed program. Pure: no DOM, no Capacitor, so Vitest runs it in Node.
//
// Only xlsx-specific checks live here (sheet names, headers, cell types, formula grammar, Massimali rows).
// Rules about the program itself live in model.js → validateProgram(), shared with the future v3 editor.
import * as XLSX from "xlsx";
import { PHASES, liftId, validateProgram } from "./model.js";

export const FORMAT_VERSION = 1;

const ACC_HEADERS = ["Giorno", "Esercizio", "Istruzioni", "Gruppo", "Rep", "Intensità"];
const SLOT_HEADER = /^(.+?) \(([A-Z])\)$/;
// load := MROUND(Massimali!$B$<row> * <number>, <number>), with optional $ and spaces.
const LOAD = /MROUND\(\s*Massimali!\$?B\$?(\d+)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*\)/iy;
// Hand-written load token inside plain text: {Squat .57} = 57% of the "Squat" max, rounded to 2.5.
const TEXT_TOKEN = /\{\s*([^{}]*?[^\s{}])\s*(\d*[.,]\d+)\s*\}/g;
const TEXT_TOKEN_STEP = 2.5;

/** Parses an .xlsx file (ArrayBuffer or Uint8Array). Returns {ok, model, errors, warnings}. */
export function parseXlsx(bytes) {
  let wb;
  try {
    wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  } catch (e) {
    return fail([{ ref: "file", msg: "non è un file xlsx leggibile" }], []);
  }
  return parseWorkbook(wb);
}

/** Same as parseXlsx, for a workbook SheetJS has already read (with cellFormula: true). */
export function parseWorkbook(wb) {
  const errors = [];
  const warnings = [];
  const err = (ref, msg) => errors.push({ ref, msg });
  const src = {}; // model path → cell reference, so validateProgram's errors can name a cell

  // Format version: no `meta` sheet means format 1 (VERSIONS.md → Foundations).
  const meta = wb.Sheets.meta;
  if (meta) {
    const v = cellValue(meta, 1, 2);
    if (text(meta, 1, 1) === "formatVersion" && typeof v === "number" && v > FORMAT_VERSION) {
      return fail([{ ref: "meta!B1", msg: `formato ${v} non supportato da questa versione dell'app (massimo ${FORMAT_VERSION}): aggiorna l'app` }], warnings);
    }
  }

  for (const name of ["Massimali", "overall", "accessori"]) {
    if (!wb.Sheets[name]) {
      const near = wb.SheetNames.find((s) => s.toLowerCase() === name.toLowerCase());
      err(name, near ? `foglio mancante (trovato "${near}": il nome deve essere identico, maiuscole comprese)` : "foglio obbligatorio mancante");
    }
  }

  const lifts = wb.Sheets.Massimali ? parseMassimali(wb.Sheets.Massimali, err, src) : null;
  const liftByRow = new Map((lifts || []).map((l) => [l._row, l]));
  const ov = wb.Sheets.overall ? parseOverall(wb.Sheets.overall, liftByRow, lifts, err, warnings, src) : null;
  const acc = wb.Sheets.accessori ? parseAccessori(wb.Sheets.accessori, ov ? ov.blocks.length : null, err, src) : null;
  const notes = wb.Sheets.note ? parseNotes(wb.Sheets.note) : [];

  if (!lifts || !ov || !acc) return fail(errors, warnings);

  const days = [...new Set([...ov.slots.map((s) => s.day), ...acc.map((a) => a.day)])].sort();
  const model = {
    schemaVersion: 1,
    lifts: lifts.map(({ _row, ...l }) => l),
    blocks: ov.blocks,
    weeks: ov.weeks,
    days,
    slots: ov.slots,
    prescriptions: ov.prescriptions,
    accessories: acc,
    notes,
  };

  // Program-level rules. Skip the ones the xlsx checks already reported, so each problem shows once.
  for (const e of validateProgram(model)) {
    const ref = locate(src, e.path);
    if (!errors.some((x) => x.ref === ref)) err(ref, e.msg);
  }

  return errors.length ? fail(errors, warnings) : { ok: true, model, errors: [], warnings };
}

/** "overall!D7: formula non riconosciuta" — the line shown on the import errors screen. */
export function formatIssue(e) {
  return `${e.ref}: ${e.msg}`;
}

// ---------------------------------------------------------------- Massimali

function parseMassimali(ws, err, src) {
  const lifts = [];
  const last = lastRow(ws);
  let empty = 0;
  for (let r = 1; r <= last; r++) {
    const a = text(ws, r, 1);
    const bCell = getCell(ws, r, 2);
    const b = bCell ? bCell.v : undefined;
    if (a === "Totale") break;
    if (!a && (b === undefined || b === "")) {
      if (++empty === 2) break;
      continue;
    }
    empty = 0;
    if (!a) continue; // a number without a name: not a lift row
    if (b === undefined || b === "") continue; // title row
    if (typeof b !== "number" || !(b > 0)) {
      err(`Massimali!B${r}`, `massimale di "${a}" non valido: serve un numero maggiore di 0`);
      continue;
    }
    const i = lifts.length;
    src[`lifts.${i}.name`] = `Massimali!A${r}`;
    src[`lifts.${i}.max`] = `Massimali!B${r}`;
    lifts.push({ id: liftId(a), name: a, max: b, _row: r });
  }
  if (!lifts.length) err("Massimali", "nessuna alzata trovata: serve un nome in colonna A e un massimale in colonna B");
  return lifts;
}

// ---------------------------------------------------------------- overall

function parseOverall(ws, liftByRow, lifts, err, warnings, src) {
  checkMerges(ws, "overall", err);
  let ok = true;
  if (text(ws, 1, 1) !== "week") { err("overall!A1", `intestazione attesa "week", trovato "${text(ws, 1, 1)}"`); ok = false; }
  if (text(ws, 1, 2) !== "fase") { err("overall!B1", `intestazione attesa "fase", trovato "${text(ws, 1, 2)}"`); ok = false; }

  const slots = [];
  for (let c = 3; text(ws, 1, c); c++) {
    const h = text(ws, 1, c);
    const m = SLOT_HEADER.exec(h);
    const ref = `overall!${col(c)}1`;
    if (!m) { err(ref, `intestazione "${h}" non valida: serve "Nome (X)", con X lettera maiuscola del giorno`); ok = false; continue; }
    src[`slots.${slots.length}.name`] = ref;
    src[`slots.${slots.length}.day`] = ref;
    slots.push({ name: m[1], day: m[2], _col: c });
  }
  if (!slots.length && ok) { err("overall!C1", "nessuna colonna di alzata: le intestazioni partono da C1"); ok = false; }
  if (!ok) return null;

  const blocks = [];
  const weeks = [];
  const prescriptions = [];
  const last = lastRow(ws);
  for (let r = 2; r <= last; r++) {
    const aCell = getCell(ws, r, 1);
    const aEmpty = !aCell || aCell.v === "" || aCell.v == null;
    const b = text(ws, r, 2);
    const slotEmpty = slots.every((s) => isEmpty(getCell(ws, r, s._col)));
    if (aEmpty && !b && slotEmpty) break; // first empty row ends the data

    if (aEmpty && b) {
      const bi = blocks.length;
      src[`blocks.${bi}.name`] = `overall!B${r}`;
      src[`blocks.${bi}.variants`] = `overall!B${r}`;
      blocks.push({ name: b, variants: slots.map((s) => text(ws, r, s._col)) });
      continue;
    }
    if (aEmpty) { err(`overall!A${r}`, "riga senza numero di settimana né nome del blocco"); continue; }

    const n = weekNumber(aCell.v);
    if (n == null) { err(`overall!A${r}`, `numero di settimana "${aCell.v}" non valido: serve un intero`); continue; }
    if (!blocks.length) { err("overall!B2", "la prima riga dopo le intestazioni deve essere un blocco (A vuota, nome del blocco in B)"); return null; }

    if (!PHASES.includes(b)) warnings.push({ ref: `overall!B${r}`, msg: `fase "${b}" non riconosciuta: viene mostrata così com'è` });
    const wi = weeks.length;
    src[`weeks.${wi}.number`] = `overall!A${r}`;
    src[`prescriptions.${wi}`] = `overall!A${r}`;
    weeks.push({ number: n, phase: b, block: blocks.length - 1 });
    prescriptions.push(slots.map((s, si) => {
      const ref = `overall!${col(s._col)}${r}`;
      src[`prescriptions.${wi}.${si}`] = ref;
      return parsePrescription(getCell(ws, r, s._col), ref, liftByRow, lifts, err);
    }));
  }
  if (!blocks.length) err("overall!B2", "nessun blocco: la prima riga dopo le intestazioni deve essere un blocco");

  return { blocks, weeks, prescriptions, slots: slots.map(({ _col, ...s }) => s) };
}

/** A prescription cell → null (not trained) or {parts: [text | {lift, pct, step}]}. */
function parsePrescription(cell, ref, liftByRow, lifts, err) {
  if (cell?.f != null) {
    const parsed = parseFormula(cell.f);
    if (parsed.error) { err(ref, parsed.error); return null; }
    const parts = [];
    for (const p of parsed.parts) {
      if (typeof p === "string") { parts.push(p); continue; }
      const lift = liftByRow.get(p.row);
      if (!lift) {
        // Without a Massimali sheet every load would fail: that is already one error, don't repeat it per cell.
        if (lifts) err(ref, `la formula usa Massimali!B${p.row}, che non è una riga di massimale`);
        return null;
      }
      parts.push({ lift: lift.id, pct: p.pct, step: p.step });
    }
    return { parts: mergeText(parts) };
  }
  if (isEmpty(cell)) return null;
  return parseTextTokens(cellText(cell), ref, lifts, err);
}

/**
 * Checks a formula against the grammar in FORMAT.md:
 *   formula := term ( "&" term )* ; term := "string" | MROUND(Massimali!$B$<row>*<n>,<n>)
 * Returns {parts} with {row, pct, step} loads, or {error}.
 */
export function parseFormula(f) {
  const s = normalize(String(f)).replace(/^=/, "");
  const parts = [];
  let i = 0;
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const bad = { error: "formula non riconosciuta (sono ammessi solo testi tra virgolette e MROUND(Massimali!$B$riga*percentuale,arrotondamento) uniti da &)" };
  for (;;) {
    skip();
    if (s[i] === '"') {
      let out = "";
      i++;
      for (;;) {
        if (i >= s.length) return { error: "formula non riconosciuta: virgolette non chiuse" };
        if (s[i] === '"') {
          if (s[i + 1] === '"') { out += '"'; i += 2; continue; }
          i++;
          break;
        }
        out += s[i++];
      }
      parts.push(out);
    } else {
      LOAD.lastIndex = i;
      const m = LOAD.exec(s);
      if (!m) return bad;
      parts.push({ row: +m[1], pct: +m[2], step: +m[3] });
      i = LOAD.lastIndex;
    }
    skip();
    if (i >= s.length) break;
    if (s[i] !== "&") return bad;
    i++;
  }
  return { parts };
}

/** Plain text with {Squat .57}-style tokens → parts. Text without tokens is one text part. */
function parseTextTokens(str, ref, lifts, err) {
  const parts = [];
  let last = 0;
  let ok = true;
  for (const m of str.matchAll(TEXT_TOKEN)) {
    const lift = (lifts || []).find((l) => l.id === liftId(m[1]));
    if (!lift) {
      err(ref, `segnaposto "${m[0]}": nessuna alzata "${m[1]}" in Massimali`);
      ok = false;
      continue;
    }
    parts.push(str.slice(last, m.index));
    parts.push({ lift: lift.id, pct: parseFloat(m[2].replace(",", ".")), step: TEXT_TOKEN_STEP });
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return ok ? { parts: mergeText(parts) } : null;
}

// ---------------------------------------------------------------- accessori

function parseAccessori(ws, blockCount, err, src) {
  checkMerges(ws, "accessori", err);
  let ok = true;
  ACC_HEADERS.forEach((h, i) => {
    const got = text(ws, 1, i + 1);
    if (got !== h) { err(`accessori!${col(i + 1)}1`, `intestazione attesa "${h}", trovato "${got}"`); ok = false; }
  });
  let n = 0;
  while (text(ws, 1, 7 + n).startsWith("Serie B")) n++;
  if (!n) { err("accessori!G1", 'servono le colonne "Serie B1", "Serie B2", … (una per blocco)'); ok = false; }
  else if (blockCount != null && n !== blockCount) {
    err(`accessori!${col(7 + n - 1)}1`, `${n} colonne "Serie B…" ma ${blockCount} blocchi in overall: devono essere uguali`);
    ok = false;
  }
  if (!ok) return null;

  const out = [];
  for (let r = 2; text(ws, r, 1); r++) {
    const day = text(ws, r, 1);
    const i = out.length;
    if (!/^[A-Z]$/.test(day)) { err(`accessori!A${r}`, `giorno "${day}" non valido: serve una sola lettera maiuscola`); continue; }
    const sets = [];
    for (let k = 0; k < n; k++) {
      const c = 7 + k;
      const v = getCell(ws, r, c)?.v;
      const num = typeof v === "number" ? v : (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? +v : NaN);
      if (!(Number.isInteger(num) && num >= 0)) err(`accessori!${col(c)}${r}`, `serie "${v ?? ""}" non valide: serve un intero ≥ 0`);
      src[`accessories.${i}.sets.${k}`] = `accessori!${col(c)}${r}`;
      sets.push(num);
    }
    src[`accessories.${i}.day`] = `accessori!A${r}`;
    src[`accessories.${i}.name`] = `accessori!B${r}`;
    src[`accessories.${i}.sets`] = `accessori!G${r}`;
    const intensity = text(ws, r, 6);
    out.push({
      day,
      name: text(ws, r, 2),
      instructions: text(ws, r, 3),
      group: text(ws, r, 4),
      reps: text(ws, r, 5),
      intensity,
      sets,
      // Counted for volume but not listed with the accessories (e.g. pull-ups already in overall).
      volumeOnly: intensity === "vedi overall",
    });
  }
  return out;
}

// ---------------------------------------------------------------- note

function parseNotes(ws) {
  const out = [];
  const last = lastRow(ws);
  for (let r = 1; r <= last; r++) {
    const t = text(ws, r, 1);
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function fail(errors, warnings) {
  return { ok: false, model: null, errors, warnings };
}

function locate(src, path) {
  const segs = path.split(".");
  while (segs.length) {
    const ref = src[segs.join(".")];
    if (ref) return ref;
    segs.pop();
  }
  return "programma";
}

function mergeText(parts) {
  const out = [];
  for (const p of parts) {
    if (p === "") continue;
    if (typeof p === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

/** Week numbers may arrive as 1, 1.0 or "1"; 1.5 is rejected. */
function weekNumber(v) {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const s = normalize(String(v));
  return /^\d+(\.0+)?$/.test(s) && parseInt(s, 10) > 0 ? parseInt(s, 10) : null;
}

function checkMerges(ws, name, err) {
  for (const m of ws["!merges"] || []) {
    err(`${name}!${XLSX.utils.encode_range(m)}`, "celle unite non ammesse");
  }
}

// Trim and turn non-breaking spaces into normal spaces (Excel and copy-paste love them).
function normalize(s) {
  return s.replace(/ /g, " ").trim();
}

function getCell(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
}

function cellValue(ws, r, c) {
  return getCell(ws, r, c)?.v;
}

function isEmpty(cell) {
  return !cell || (cell.f == null && (cell.v == null || (typeof cell.v === "string" && normalize(cell.v) === "")));
}

function cellText(cell) {
  if (!cell || cell.v == null) return "";
  // Numbers: use Excel's displayed text when SheetJS has it, so 7.5 shows as the sheet shows it.
  return normalize(typeof cell.v === "string" ? cell.v : (cell.w ?? String(cell.v)));
}

function text(ws, r, c) {
  return cellText(getCell(ws, r, c));
}

function lastRow(ws) {
  return ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).e.r + 1 : 0;
}

function col(c) {
  return XLSX.utils.encode_col(c - 1);
}
