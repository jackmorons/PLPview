// Cell reading, the load-formula grammar and the Massimali sheet: shared by both xlsx formats
// (parse-pl28.js, parse-coach.js). Pure: no DOM, no Capacitor.
import * as XLSX from "xlsx";
import { liftId } from "./model.js";

// load := MROUND(Massimali!$B$<row> * <number>, <number>), with optional $ and spaces.
const LOAD = /MROUND\(\s*Massimali!\$?B\$?(\d+)\s*\*\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*\)/iy;
// Hand-written load placeholder inside plain text: {Squat .57} = 57% of the "Squat" max, rounded to 2.5.
const TEXT_TOKEN = /\{\s*([^{}]*?[^\s{}])\s*(\d*[.,]\d+)\s*\}/g;
const TEXT_TOKEN_STEP = 2.5;

export const BAD_FORMULA = "formula non riconosciuta (sono ammessi solo testi tra virgolette e MROUND(Massimali!$B$riga*percentuale,arrotondamento) uniti da &)";

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
      if (!m) return { error: BAD_FORMULA };
      parts.push({ row: +m[1], pct: +m[2], step: +m[3] });
      i = LOAD.lastIndex;
    }
    skip();
    if (i >= s.length) break;
    if (s[i] !== "&") return { error: BAD_FORMULA };
    i++;
  }
  return { parts };
}

/** Turns {row} loads into {lift} tokens. Returns {template} or {error}. `lifts` is null without a Massimali sheet. */
export function bindLoads(parts, lifts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === "string") { out.push(p); continue; }
    if (!lifts) return { error: "la formula usa Massimali, ma il foglio Massimali non c'è" };
    const lift = lifts.find((l) => l._row === p.row);
    if (!lift) return { error: `la formula usa Massimali!B${p.row}, che non è una riga di massimale` };
    out.push({ lift: lift.id, pct: p.pct, step: p.step });
  }
  return { template: { parts: mergeText(out) } };
}

/** Plain text with {Squat .57}-style placeholders → {template} or {error}. */
export function parseTextTokens(str, lifts) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(TEXT_TOKEN)) {
    const lift = (lifts || []).find((l) => l.id === liftId(m[1]));
    if (!lift) return { error: `segnaposto "${m[0]}": nessuna alzata "${m[1]}" in Massimali` };
    parts.push(str.slice(last, m.index));
    parts.push({ lift: lift.id, pct: parseFloat(m[2].replace(",", ".")), step: TEXT_TOKEN_STEP });
    last = m.index + m[0].length;
  }
  parts.push(str.slice(last));
  return { template: { parts: mergeText(parts) } };
}

/**
 * The Massimali sheet: name in A, max > 0 in B, until "Totale" or two empty rows.
 * Returns lifts with their sheet row in `_row` (formulas point at rows); the caller strips `_row`.
 */
export function parseMassimali(ws, err, src) {
  const lifts = [];
  const last = lastRow(ws);
  let empty = 0;
  for (let r = 1; r <= last; r++) {
    const a = text(ws, r, 1);
    const b = getCell(ws, r, 2)?.v;
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
    src[`lifts.${lifts.length}.name`] = `Massimali!A${r}`;
    src[`lifts.${lifts.length}.max`] = `Massimali!B${r}`;
    lifts.push({ id: liftId(a), name: a, defaultMax: b, _row: r });
  }
  if (!lifts.length) err("Massimali", "nessuna alzata trovata: serve un nome in colonna A e un massimale in colonna B");
  return lifts;
}

/** The `note` sheet: column A, one paragraph per non-empty row. */
export function parseNotes(ws) {
  const out = [];
  if (!ws) return out;
  const last = lastRow(ws);
  for (let r = 1; r <= last; r++) {
    const t = text(ws, r, 1);
    if (t) out.push(t);
  }
  return out;
}

/** Week numbers may arrive as 1, 1.0 or "1"; 1.5 is rejected (null). */
export function weekNumber(v) {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const s = normalize(String(v));
  return /^\d+(\.0+)?$/.test(s) && parseInt(s, 10) > 0 ? parseInt(s, 10) : null;
}

export function checkMerges(ws, name, err) {
  for (const m of ws["!merges"] || []) err(`${name}!${XLSX.utils.encode_range(m)}`, "celle unite non ammesse");
}

/** Model path → cell reference, falling back to the nearest parent path that has one. */
export function locate(src, path) {
  const segs = path.split(".");
  while (segs.length) {
    const ref = src[segs.join(".")];
    if (ref) return ref;
    segs.pop();
  }
  return "programma";
}

export function mergeText(parts) {
  const out = [];
  for (const p of parts) {
    if (p === "") continue;
    if (typeof p === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

// Trim and turn non-breaking spaces into normal spaces (Excel and copy-paste love them).
export function normalize(s) {
  return s.replace(/ /g, " ").trim();
}

export function getCell(ws, r, c) {
  return ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
}

export function isEmpty(cell) {
  return !cell || (cell.f == null && (cell.v == null || (typeof cell.v === "string" && normalize(cell.v) === "")));
}

/** A cell's text. Numbers use Italian format (110 → "110", 112.5 → "112,5"). */
export function cellText(cell) {
  if (!cell || cell.v == null) return "";
  if (typeof cell.v === "number") return (Math.round(cell.v * 100) / 100).toString().replace(".", ",");
  return normalize(String(cell.v));
}

export function text(ws, r, c) {
  return cellText(getCell(ws, r, c));
}

export function lastRow(ws) {
  return ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).e.r + 1 : 0;
}

export function lastCol(ws) {
  return ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).e.c + 1 : 0;
}

export function col(c) {
  return XLSX.utils.encode_col(c - 1);
}
