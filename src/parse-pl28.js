// The PL28 format (docs/FORMAT.md): Massimali + overall (slots × weeks) + accessori (sets per block).
// Reads the sheets into the schema-1 shape, then model.js → expandV1() turns it into explicit sessions
// (schema 2), applying −1 set / RIR +1 to transizione, scarico and test weeks.
// Called by parser.js. Pure: no DOM, no Capacitor.
import { expandV1, validateProgram, weekType, WEEK_TYPES } from "./model.js";
import {
  parseFormula, bindLoads, parseTextTokens, parseMassimali, parseNotes, weekNumber, checkMerges, locate,
  getCell, isEmpty, cellText, text, lastRow, col,
} from "./parse-common.js";

const ACC_HEADERS = ["Giorno", "Esercizio", "Istruzioni", "Gruppo", "Rep", "Intensità"];
const SLOT_HEADER = /^(.+?) \(([A-Z])\)$/;

export function parsePL28(wb, err) {
  const src = {}; // model path → cell, so validateProgram's errors can name a cell
  const v1 = readV1(wb, err, src);
  if (!v1) return null;
  const model = expandV1(v1);
  for (const e of validateProgram(model)) err(locate(src, e.path), e.msg);
  return model;
}

/** The sheets as schema 1 (slots × weeks, accessories per block). Exported for the migration test. */
export function readV1(wb, err, src = {}) {
  for (const name of ["Massimali", "overall"]) {
    if (!wb.Sheets[name]) {
      const near = wb.SheetNames.find((s) => s.toLowerCase() === name.toLowerCase());
      err(name, near ? `foglio mancante (trovato "${near}": il nome deve essere identico, maiuscole comprese)` : "foglio obbligatorio mancante");
    }
  }
  const lifts = wb.Sheets.Massimali ? parseMassimali(wb.Sheets.Massimali, err, src) : null;
  const ov = wb.Sheets.overall ? parseOverall(wb.Sheets.overall, lifts, err, src) : null;
  const acc = parseAccessori(wb.Sheets.accessori, ov ? ov.blocks.length : null, err);
  if (!lifts || !ov || !acc) return null;

  const v1 = {
    lifts: lifts.map(({ _row, ...l }) => l),
    blocks: ov.blocks,
    weeks: ov.weeks,
    days: [...new Set([...ov.slots.map((s) => s.day), ...acc.map((a) => a.day)])].sort(),
    slots: ov.slots,
    prescriptions: ov.prescriptions,
    accessories: acc,
    notes: parseNotes(wb.Sheets.note),
  };
  // expandV1 needs every block to have weeks and every week to be numbered; stop here if not.
  const empty = v1.blocks.findIndex((_, bi) => !v1.weeks.some((w) => w.block === bi));
  if (empty >= 0) { err(src[`blocks.${empty}`], `il blocco "${v1.blocks[empty].name}" non ha settimane`); return null; }
  if (!v1.weeks.length) { err("overall!A3", "nessuna settimana"); return null; }
  return v1;
}

function parseOverall(ws, lifts, err, src) {
  checkMerges(ws, "overall", err);
  let ok = true;
  if (text(ws, 1, 1) !== "week") { err("overall!A1", `intestazione attesa "week", trovato "${text(ws, 1, 1)}"`); ok = false; }
  if (text(ws, 1, 2) !== "fase") { err("overall!B1", `intestazione attesa "fase", trovato "${text(ws, 1, 2)}"`); ok = false; }

  const slots = [];
  for (let c = 3; text(ws, 1, c); c++) {
    const h = text(ws, 1, c);
    const m = SLOT_HEADER.exec(h);
    if (!m) { err(`overall!${col(c)}1`, `intestazione "${h}" non valida: serve "Nome (X)", con X lettera maiuscola del giorno`); ok = false; continue; }
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
    const aEmpty = isEmpty(aCell);
    const b = text(ws, r, 2);
    const slotEmpty = slots.every((s) => isEmpty(getCell(ws, r, s._col)));
    if (aEmpty && !b && slotEmpty) break; // first empty row ends the data

    if (aEmpty && b) {
      src[`blocks.${blocks.length}`] = `overall!B${r}`;
      blocks.push({ name: b, variants: slots.map((s) => text(ws, r, s._col)) });
      continue;
    }
    if (aEmpty) { err(`overall!A${r}`, "riga senza numero di settimana né nome del blocco"); continue; }

    const n = weekNumber(aCell.v);
    if (n == null) { err(`overall!A${r}`, `numero di settimana "${aCell.v}" non valido: serve un intero`); continue; }
    if (!blocks.length) { err("overall!B2", "la prima riga dopo le intestazioni deve essere un blocco (A vuota, nome del blocco in B)"); return null; }

    const type = weekType(b);
    if (!type) err(`overall!B${r}`, `tipo di settimana "${b}" non valido: usa ${WEEK_TYPES.join(", ")}`);
    const wi = weeks.length;
    src[`weeks.${wi}.n`] = `overall!A${r}`;
    src[`weeks.${wi}.type`] = `overall!B${r}`;
    src[`weeks.${wi}`] = `overall!A${r}`;
    weeks.push({ number: n, type: type || "normale", block: blocks.length - 1 });
    prescriptions.push(slots.map((s) => parsePrescription(getCell(ws, r, s._col), `overall!${col(s._col)}${r}`, lifts, err)));
  }
  if (!blocks.length) err("overall!B2", "nessun blocco: la prima riga dopo le intestazioni deve essere un blocco");

  return { blocks, weeks, prescriptions, slots: slots.map(({ _col, ...s }) => s) };
}

/** A prescription cell → null (not trained) or a template {parts}. */
function parsePrescription(cell, ref, lifts, err) {
  if (cell?.f != null) {
    const parsed = parseFormula(cell.f);
    if (parsed.error) { err(ref, parsed.error); return null; }
    // Without a Massimali sheet every load would fail: that's already one error, don't repeat it per cell.
    const bound = bindLoads(parsed.parts, lifts || []);
    if (bound.error) { if (lifts) err(ref, bound.error); return null; }
    return bound.template;
  }
  if (isEmpty(cell)) return null;
  const t = parseTextTokens(cellText(cell), lifts);
  if (t.error) { err(ref, t.error); return null; }
  return t.template;
}

function parseAccessori(ws, blockCount, err) {
  if (!ws) return null; // parser.js only calls us when the sheet exists
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
    if (!/^[A-Z]$/.test(day)) { err(`accessori!A${r}`, `giorno "${day}" non valido: serve una sola lettera maiuscola`); continue; }
    if (!text(ws, r, 2)) err(`accessori!B${r}`, "esercizio senza nome");
    const sets = [];
    for (let k = 0; k < n; k++) {
      const c = 7 + k;
      const v = getCell(ws, r, c)?.v;
      const num = typeof v === "number" ? v : (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? +v : NaN);
      if (!(Number.isInteger(num) && num >= 0)) err(`accessori!${col(c)}${r}`, `serie "${v ?? ""}" non valide: serve un intero ≥ 0`);
      sets.push(num);
    }
    const intensity = text(ws, r, 6);
    out.push({
      day, name: text(ws, r, 2), instructions: text(ws, r, 3), group: text(ws, r, 4), reps: text(ws, r, 5), intensity, sets,
      // Counted for volume but not listed with the accessories (e.g. pull-ups already in overall).
      volumeOnly: intensity === "vedi overall",
    });
  }
  return out;
}
