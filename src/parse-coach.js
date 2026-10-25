// The coach format (docs/FORMAT-COACH.md, PL27 layout): every session written out in a `training log` sheet,
// one row per exercise. `overall` (optional) gives week types, dates and blocks, and holds the main-lift cells
// the log points at with =overall!C3. `Massimali` (optional) makes MROUND loads follow the maxes.
// Called by parser.js. Pure: no DOM, no Capacitor.
import { validateProgram, weekType, WEEK_TYPES } from "./model.js";
import {
  parseFormula, bindLoads, parseTextTokens, parseMassimali, parseNotes, weekNumber, checkMerges, locate,
  getCell, isEmpty, cellText, text, lastRow, lastCol, col,
} from "./parse-common.js";

const LOG_HEADERS = ["settimana", "giorno", "alzata", "istruzioni", "serie x rep", "kg/rpe", "carico usato", "difficoltà", "note"];
const MAIN_BY_NAME = /^(squat|panca|stacco|trazioni)\b/;
const OVERALL_REF = /^\s*=?\s*overall!\$?([A-Z]{1,3})\$?(\d+)\s*$/i;

export function parseCoach(wb, logName, err, warnings) {
  const src = {};
  const ws = wb.Sheets[logName];
  const lifts = wb.Sheets.Massimali ? parseMassimali(wb.Sheets.Massimali, err, src) : null;
  const ctx = { wb, lifts, err };
  const ov = wb.Sheets.overall ? readOverall(wb.Sheets.overall, ctx) : null;

  // ---- headers
  checkMerges(ws, logName, err);
  let ok = true;
  LOG_HEADERS.forEach((h, i) => {
    const got = text(ws, 1, i + 1);
    if (got.toLowerCase() !== h) { err(`${logName}!${col(i + 1)}1`, `intestazione attesa "${cap(h)}", trovato "${got}"`); ok = false; }
  });
  const jHeader = text(ws, 1, 10);
  const hasGroup = jHeader.toLowerCase() === "gruppo";
  if (jHeader && !hasGroup) warnings.push({ ref: `${logName}!J1`, msg: `colonna "${jHeader}" ignorata (qui può stare solo "Gruppo")` });
  if (!ok) return null;

  // ---- rows: everything down to the last row with something in A, B or C; blank rows are separators
  let last = 0;
  for (let r = lastRow(ws); r >= 2 && !last; r--) if ([1, 2, 3].some((c) => !isEmpty(getCell(ws, r, c)))) last = r;

  const rows = [];
  for (let r = 2; r <= last; r++) {
    const [a, b, c] = [1, 2, 3].map((k) => getCell(ws, r, k));
    if (isEmpty(a) && isEmpty(b) && isEmpty(c)) continue;
    const n = isEmpty(a) ? null : weekNumber(a.v);
    if (isEmpty(a)) err(`${logName}!A${r}`, "settimana mancante");
    else if (n == null) err(`${logName}!A${r}`, `settimana "${a.v}" non valida: serve un intero ≥ 1`);
    const day = cellText(b).toUpperCase();
    if (!day) err(`${logName}!B${r}`, "giorno mancante");
    else if (!/^[A-Z]$/.test(day)) err(`${logName}!B${r}`, `giorno "${cellText(b)}" non valido: serve una sola lettera`);
    const name = cellText(c);
    if (!name) err(`${logName}!C${r}`, "alzata mancante");
    if (n == null || !/^[A-Z]$/.test(day) || !name) continue;
    rows.push({ r, n, day, name });
  }

  // ---- structure: weeks never go back; each week+day is one contiguous run of rows
  const runs = [];
  for (const row of rows) {
    const prev = runs[runs.length - 1];
    if (prev && prev.n === row.n && prev.day === row.day) { prev.rows.push(row); continue; }
    if (prev && row.n < prev.n) err(`${logName}!A${row.r}`, `settimana ${row.n} dopo la settimana ${prev.n}: le settimane non possono tornare indietro`);
    const earlier = runs.find((x) => x.n === row.n && x.day === row.day && !x.repeated);
    if (earlier) err(`${logName}!A${row.r}`, `settimana ${row.n} giorno ${row.day} ripetuta alle righe ${earlier.rows[0].r} e ${row.r}`);
    // A repeated run is reported once here and left out of the sessions, so the model checks don't repeat it.
    runs.push({ n: row.n, day: row.day, rows: [row], repeated: !!earlier });
  }

  // ---- sessions
  const weeks = [];
  for (const run of runs) {
    if (run.repeated) continue;
    let w = weeks.find((x) => x.n === run.n);
    if (!w) {
      const o = ov?.weeks.get(run.n);
      w = { n: run.n, type: o?.type || "normale", dates: o?.dates || null, block: null, days: [] };
      src[`weeks.${weeks.length}.n`] = `${logName}!A${run.rows[0].r}`;
      src[`weeks.${weeks.length}`] = `${logName}!A${run.rows[0].r}`;
      weeks.push(w);
    }
    const wi = weeks.indexOf(w);
    const di = w.days.length;
    src[`weeks.${wi}.days.${di}`] = `${logName}!B${run.rows[0].r}`;
    w.days.push({
      letter: run.day,
      items: run.rows.map((row, ii) => {
        const p = `weeks.${wi}.days.${di}.items.${ii}`;
        src[p] = src[`${p}.name`] = `${logName}!C${row.r}`;
        src[`${p}.prescription`] = `${logName}!E${row.r}`;
        src[`${p}.load`] = `${logName}!F${row.r}`;
        src[`${p}.note`] = `${logName}!I${row.r}`;
        return item(ws, logName, row, hasGroup, ctx);
      }),
    });
  }
  weeks.sort((a, b) => a.n - b.n);

  // Day order: as they first appear in week 1, then any other letters alphabetically.
  const first = weeks[0]?.days.map((d) => d.letter) || [];
  const others = [...new Set(weeks.flatMap((w) => w.days.map((d) => d.letter)))].filter((d) => !first.includes(d)).sort();
  const days = [...first, ...others];

  // Blocks come from overall's variant rows; weeks not in overall have no block.
  const blocks = [];
  if (ov) {
    for (const w of weeks) {
      const bi = ov.weeks.get(w.n)?.block;
      if (bi == null) continue;
      let b = blocks.find((x) => x._ov === bi);
      if (!b) { b = { name: `Blocco ${blocks.length + 1}`, firstWeek: w.n, lastWeek: w.n, _ov: bi }; blocks.push(b); }
      b.lastWeek = w.n;
      w.block = blocks.indexOf(b);
    }
    // Cross-check: warnings only.
    const inLog = new Set(weeks.map((w) => w.n));
    for (const [n, o] of ov.weeks) if (!inLog.has(n)) warnings.push({ ref: `overall!A${o.row}`, msg: `la settimana ${n} è in overall ma non nel ${logName}` });
    for (const w of weeks) if (!ov.weeks.has(w.n)) warnings.push({ ref: src[`weeks.${weeks.indexOf(w)}.n`], msg: `la settimana ${w.n} è nel ${logName} ma non in overall` });
  }

  const model = {
    schemaVersion: 2,
    format: "coach",
    lifts: (lifts || []).map(({ _row, ...l }) => l),
    days,
    weeks,
    blocks: blocks.map(({ _ov, ...b }) => b),
    notes: parseNotes(wb.Sheets.note),
  };
  for (const e of validateProgram(model)) err(locate(src, e.path), e.msg);
  return model;
}

/** One log row → item. */
function item(ws, logName, row, hasGroup, ctx) {
  const at = (c) => ({ cell: getCell(ws, row.r, c), ref: `${logName}!${col(c)}${row.r}` });
  const group = hasGroup ? cellText(getCell(ws, row.r, 10)) : "";
  let kind;
  if (group) kind = group.toLowerCase() === "fondamentale" ? "main" : "acc";
  else kind = MAIN_BY_NAME.test(row.name.toLowerCase()) ? "main" : "acc";
  return {
    kind,
    name: row.name,
    instructions: plain(resolve(at(4), ctx), at(4).ref, ctx),
    prescription: resolve(at(5), ctx),
    load: resolve(at(6), ctx),
    group: group || null,
    note: resolve(at(9), ctx),
  };
}

/**
 * A cell's value as a template, or null if empty. Plain text (with {Squat .57} placeholders), a load formula,
 * or =overall!C3, which is read recursively. Anything else is an error: never the cached value.
 */
function resolve({ cell, ref }, ctx, depth = 0) {
  if (isEmpty(cell)) return null;
  if (cell.f == null) {
    const t = parseTextTokens(cellText(cell), ctx.lifts);
    if (t.error) { ctx.err(ref, t.error); return null; }
    return t.template;
  }
  const m = OVERALL_REF.exec(cell.f);
  if (m) {
    const ow = ctx.wb.Sheets.overall;
    if (!ow) { ctx.err(ref, "la formula punta a overall, ma il foglio overall non c'è"); return null; }
    if (depth > 10) { ctx.err(ref, "riferimenti a overall in cerchio"); return null; }
    const target = `${m[1].toUpperCase()}${m[2]}`;
    return resolve({ cell: ow[target], ref: `overall!${target}` }, ctx, depth + 1);
  }
  const parsed = parseFormula(cell.f);
  if (parsed.error) { ctx.err(ref, parsed.error); return null; }
  const bound = bindLoads(parsed.parts, ctx.lifts);
  if (bound.error) { ctx.err(ref, bound.error); return null; }
  return bound.template;
}

/** Instructions are plain text: a template without loads, joined. */
function plain(tpl, ref, ctx) {
  if (!tpl) return null;
  if (tpl.parts.some((p) => typeof p !== "string")) { ctx.err(ref, "le istruzioni non possono contenere carichi"); return null; }
  return tpl.parts.join("");
}

/**
 * `overall` in PL27 layout: A week, B dates, an optional `tipo` column, then slot columns (empty columns are
 * separators). A row with A and B empty and some slot text is a variant row and starts a new block.
 * Returns {weeks: Map(n → {row, type, dates, block})}.
 */
function readOverall(ws, ctx) {
  const { err } = ctx;
  checkMerges(ws, "overall", err);
  if (text(ws, 1, 1).toLowerCase() !== "week") err("overall!A1", `intestazione attesa "week", trovato "${text(ws, 1, 1)}"`);
  if (text(ws, 1, 2).toLowerCase() !== "giorno") err("overall!B1", `intestazione attesa "giorno", trovato "${text(ws, 1, 2)}"`);
  const lc = lastCol(ws);
  let tipoCol = null;
  const slotCols = [];
  for (let c = 3; c <= lc; c++) {
    const h = text(ws, 1, c);
    if (!h) continue;
    if (h.toLowerCase() === "tipo") tipoCol = c;
    else slotCols.push(c);
  }

  const weeks = new Map();
  let block = -1;
  const last = lastRow(ws);
  for (let r = 2; r <= last; r++) {
    const a = getCell(ws, r, 1);
    const b = text(ws, r, 2);
    const slotText = slotCols.some((c) => !isEmpty(getCell(ws, r, c)));
    if (isEmpty(a)) {
      if (!b && slotText) block++; // variant row
      else if (b) err(`overall!A${r}`, "riga con le date ma senza numero di settimana");
      continue;
    }
    const n = weekNumber(a.v);
    if (n == null) { err(`overall!A${r}`, `numero di settimana "${a.v}" non valido: serve un intero`); continue; }
    if (weeks.has(n)) { err(`overall!A${r}`, `settimana ${n} ripetuta in overall`); continue; }
    let type = "normale";
    if (tipoCol) {
      const raw = text(ws, r, tipoCol);
      type = weekType(raw);
      if (!type) { err(`overall!${col(tipoCol)}${r}`, `tipo di settimana "${raw}" non valido: usa ${WEEK_TYPES.join(", ")}`); type = "normale"; }
    }
    // Check every slot cell now, so a broken formula in overall is reported even if the log doesn't use it.
    for (const c of slotCols) resolve({ cell: getCell(ws, r, c), ref: `overall!${col(c)}${r}` }, ctx);
    weeks.set(n, { row: r, type, dates: b || null, block: block >= 0 ? block : null });
  }
  return { weeks };
}

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

