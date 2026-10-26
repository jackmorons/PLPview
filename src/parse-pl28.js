// The PL28 format (docs/FORMAT.md): Massimali + overall (slots × weeks) + accessori (sets per block).
// Reads the sheets into the schema-1 shape, then model.js → expandV1() turns it into explicit sessions
// (schema 2), applying −1 set / RIR +1 to transizione, scarico and test weeks.
// `overall` comes in the layout shared with the coach format (week | giorno | tipo | …) or the older one
// (week | fase | …); parse-common.js → scanOverall() reads both.
// Called by parser.js. Pure: no DOM, no Capacitor.
import { expandV1, validateProgram, weekType, WEEK_TYPES } from "./model.js";
import {
  parseFormula, bindLoads, parseTextTokens, parseMassimali, parseNotes, weekNumber, checkMerges, locate,
  findSheet, sameHeader, scanOverall, getCell, isEmpty, cellText, text, col,
} from "./parse-common.js";

const ACC_HEADERS = ["Giorno", "Esercizio", "Istruzioni", "Gruppo", "Rep", "Intensità"];
const SLOT_HEADER = /^(.+?) \(([A-Za-z])\)$/;

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
  const sheets = { Massimali: findSheet(wb, "Massimali"), overall: findSheet(wb, "overall") };
  for (const [name, ws] of Object.entries(sheets)) if (!ws) err(name, "foglio obbligatorio mancante");
  const lifts = sheets.Massimali ? parseMassimali(sheets.Massimali, err, src) : null;
  const ov = sheets.overall ? parseOverall(sheets.overall, lifts, err, src) : null;
  const acc = parseAccessori(findSheet(wb, "accessori"), ov ? ov.blocks.length : null, lifts, err);
  if (!lifts || !ov || !acc) return null;

  const v1 = {
    lifts: lifts.map(({ _row, ...l }) => l),
    blocks: ov.blocks,
    weeks: ov.weeks,
    days: [...new Set([...ov.slots.map((s) => s.day), ...acc.map((a) => a.day)])].sort(),
    slots: ov.slots,
    prescriptions: ov.prescriptions,
    accessories: acc,
    notes: parseNotes(findSheet(wb, "note")),
  };
  // expandV1 needs every block to have weeks and every week to be numbered; stop here if not.
  const empty = v1.blocks.findIndex((_, bi) => !v1.weeks.some((w) => w.block === bi));
  if (empty >= 0) { err(src[`blocks.${empty}`], `il blocco "${v1.blocks[empty].name}" non ha settimane`); return null; }
  if (!v1.weeks.length) { err("overall!A2", "nessuna settimana"); return null; }
  return v1;
}

function parseOverall(ws, lifts, err, src) {
  checkMerges(ws, "overall", err);
  const scan = scanOverall(ws, err, ["giorno", "fase"]);
  if (!scan) return null;

  let ok = true;
  const slots = [];
  for (const { c, header } of scan.liftCols) {
    const m = SLOT_HEADER.exec(header);
    if (!m) { err(`overall!${col(c)}1`, `intestazione "${header}" non valida: serve "Nome (X)", con X lettera del giorno`); ok = false; continue; }
    slots.push({ name: m[1], day: m[2].toUpperCase(), _col: c });
  }
  if (!slots.length && ok) { err(`overall!${col(scan.tipoCol ? scan.tipoCol + 1 : 3)}1`, "nessuna colonna di alzata"); ok = false; }
  if (!ok) return null;

  const blocks = [];
  const weeks = [];
  const prescriptions = [];
  for (const row of scan.rows) {
    const { r } = row;
    if (row.kind === "block") {
      src[`blocks.${blocks.length}`] = `overall!B${r}`;
      blocks.push({ name: row.name || `Blocco ${blocks.length + 1}`, variants: slots.map((s) => text(ws, r, s._col)) });
      continue;
    }
    const n = weekNumber(row.a.v);
    if (n == null) { err(`overall!A${r}`, `numero di settimana "${row.a.v}" non valido: serve un intero`); continue; }
    if (!blocks.length) { err(`overall!A${r}`, "prima della prima settimana serve una riga di blocco (A vuota, nome del blocco in B)"); return null; }

    const type = weekType(row.type);
    if (!type) err(row.typeRef, `tipo di settimana "${row.type}" non valido: usa ${WEEK_TYPES.join(", ")}`);
    const wi = weeks.length;
    src[`weeks.${wi}.n`] = `overall!A${r}`;
    src[`weeks.${wi}.type`] = row.typeRef || `overall!A${r}`;
    src[`weeks.${wi}`] = `overall!A${r}`;
    weeks.push({ number: n, type: type || "normale", block: blocks.length - 1, dates: row.dates });
    prescriptions.push(slots.map((s) => parsePrescription(getCell(ws, r, s._col), `overall!${col(s._col)}${r}`, lifts, err)));
  }
  if (!blocks.length) err("overall!B2", "nessun blocco: prima della prima settimana serve una riga di blocco");

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

/**
 * The accessori sheet: one row per exercise, sets per block in the "Serie B…" columns.
 * Rep and Intensità are templates (text, a load formula or {Squat .57} placeholders); Istruzioni is plain text.
 */
function parseAccessori(ws, blockCount, lifts, err) {
  if (!ws) return null; // parser.js only calls us when the sheet exists
  checkMerges(ws, "accessori", err);
  let ok = true;
  ACC_HEADERS.forEach((h, i) => {
    const got = text(ws, 1, i + 1);
    if (!sameHeader(got, h)) { err(`accessori!${col(i + 1)}1`, `intestazione attesa "${h}", trovato "${got}"`); ok = false; }
  });
  let n = 0;
  while (text(ws, 1, 7 + n).toLowerCase().startsWith("serie b")) n++;
  if (!n) { err("accessori!G1", 'servono le colonne "Serie B1", "Serie B2", … (una per blocco)'); ok = false; }
  else if (blockCount != null && n !== blockCount) {
    err(`accessori!${col(7 + n - 1)}1`, `${n} colonne "Serie B…" ma ${blockCount} blocchi in overall: devono essere uguali`);
    ok = false;
  }
  if (!ok) return null;

  const out = [];
  for (let r = 2; text(ws, r, 1); r++) {
    const day = text(ws, r, 1).toUpperCase();
    if (!/^[A-Z]$/.test(day)) { err(`accessori!A${r}`, `giorno "${text(ws, r, 1)}" non valido: serve una sola lettera`); continue; }
    if (!text(ws, r, 2)) err(`accessori!B${r}`, "esercizio senza nome");
    const sets = [];
    for (let k = 0; k < n; k++) {
      const c = 7 + k;
      const v = getCell(ws, r, c)?.v;
      const num = typeof v === "number" ? v : (typeof v === "string" && /^\s*\d+\s*$/.test(v) ? +v : NaN);
      if (!(Number.isInteger(num) && num >= 0)) err(`accessori!${col(c)}${r}`, `serie "${v ?? ""}" non valide: serve un intero ≥ 0`);
      sets.push(num);
    }
    const reps = parsePrescription(getCell(ws, r, 5), `accessori!E${r}`, lifts, err);
    const intensity = parsePrescription(getCell(ws, r, 6), `accessori!F${r}`, lifts, err);
    out.push({
      day, name: text(ws, r, 2), instructions: text(ws, r, 3), group: text(ws, r, 4), reps, intensity, sets,
      // Counted for volume but not listed with the accessories (e.g. pull-ups already in overall).
      volumeOnly: text(ws, r, 6).toLowerCase() === "vedi overall",
    });
  }
  return out;
}
