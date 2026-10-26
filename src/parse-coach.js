// The coach format (docs/FORMAT-COACH.md, PL27 layout): every session written out in a `training log` sheet,
// one row per exercise. `overall` (optional) gives week types, dates and blocks, and holds the main-lift cells
// the log points at with =overall!C3. `Massimali` (optional) makes MROUND loads follow the maxes.
// Called by parser.js. Pure: no DOM, no Capacitor.
import { validateProgram, weekType, WEEK_TYPES, SCHEMA_VERSION } from "./model.js";
import {
  parseFormula, bindLoads, parseTextTokens, parseMassimali, parseNotes, weekNumber, checkMerges, locate,
  findSheet, scanOverall, getCell, isEmpty, cellText, text, lastRow, col,
} from "./parse-common.js";

const LOG_HEADERS = ["settimana", "giorno", "alzata", "istruzioni", "serie x rep", "kg/rpe", "carico usato", "difficoltà", "note"];
const MAIN_BY_NAME = /^(squat|panca|stacco|trazioni)\b/;
const OVERALL_REF = /^\s*=?\s*overall!\$?([A-Z]{1,3})\$?(\d+)\s*$/i;

export function parseCoach(wb, logName, err, warnings) {
  const src = {};
  const ws = wb.Sheets[logName];
  const massimali = findSheet(wb, "Massimali");
  const lifts = massimali ? parseMassimali(massimali, err, src) : null;
  const ctx = { overall: findSheet(wb, "overall"), lifts, err };
  const ov = ctx.overall ? readOverall(ctx.overall, ctx) : null;

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

  // Day order: alphabetical, as in the PL28 format (decided 2026-10-26).
  const days = [...new Set(weeks.flatMap((w) => w.days.map((d) => d.letter)))].sort();

  // Blocks come from overall's variant rows; weeks not in overall have no block.
  const blocks = [];
  if (ov) {
    for (const w of weeks) {
      const bi = ov.weeks.get(w.n)?.block;
      if (bi == null) continue;
      let b = blocks.find((x) => x._ov === bi);
      if (!b) { b = { name: ov.blockNames[bi] || `Blocco ${blocks.length + 1}`, firstWeek: w.n, lastWeek: w.n, _ov: bi }; blocks.push(b); }
      b.lastWeek = w.n;
      w.block = blocks.indexOf(b);
    }
    // Cross-check: warnings only.
    const inLog = new Set(weeks.map((w) => w.n));
    for (const [n, o] of ov.weeks) if (!inLog.has(n)) warnings.push({ ref: `overall!A${o.row}`, msg: `la settimana ${n} è in overall ma non nel ${logName}` });
    for (const w of weeks) if (!ov.weeks.has(w.n)) warnings.push({ ref: src[`weeks.${weeks.indexOf(w)}.n`], msg: `la settimana ${w.n} è nel ${logName} ma non in overall` });
  }

  const model = {
    schemaVersion: SCHEMA_VERSION,
    format: "coach",
    lifts: (lifts || []).map(({ _row, ...l }) => l),
    days,
    weeks,
    blocks: blocks.map(({ _ov, ...b }) => b),
    notes: parseNotes(findSheet(wb, "note")),
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
  // A row whose E points at an overall cell takes that column's lift type (the `tipo alzata` row).
  const ref = at(5).cell?.f != null && OVERALL_REF.exec(at(5).cell.f);
  return {
    kind,
    name: row.name,
    instructions: plain(resolve(at(4), ctx), at(4).ref, ctx),
    liftType: (ref && ctx.liftTypes?.[ref[1].toUpperCase()]) || null,
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
    const ow = ctx.overall;
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
 * `overall` in the shared layout (parse-common.js → scanOverall): week | giorno (dates) | optional tipo | lift columns.
 * Each block row starts a new block, named by B if it has a name.
 * Returns {weeks: Map(n → {row, type, dates, block}), blockNames: [name or null per block]}.
 */
function readOverall(ws, ctx) {
  const { err } = ctx;
  checkMerges(ws, "overall", err);
  const weeks = new Map();
  const blockNames = [];
  const scan = scanOverall(ws, err, ["giorno"]);
  if (!scan) return { weeks, blockNames };
  ctx.liftTypes = Object.fromEntries(scan.liftCols.filter((l) => l.liftType).map((l) => [col(l.c), l.liftType]));

  for (const row of scan.rows) {
    const { r } = row;
    if (row.kind === "block") { blockNames.push(row.name); continue; }
    const n = weekNumber(row.a.v);
    if (n == null) { err(`overall!A${r}`, `numero di settimana "${row.a.v}" non valido: serve un intero`); continue; }
    if (weeks.has(n)) { err(`overall!A${r}`, `settimana ${n} ripetuta in overall`); continue; }
    let type = weekType(row.type);
    if (!type) { err(row.typeRef, `tipo di settimana "${row.type}" non valido: usa ${WEEK_TYPES.join(", ")}`); type = "normale"; }
    // Check every lift cell now, so a broken formula in overall is reported even if the log doesn't use it.
    for (const { c } of scan.liftCols) resolve({ cell: getCell(ws, r, c), ref: `overall!${col(c)}${r}` }, ctx);
    weeks.set(n, { row: r, type, dates: row.dates, block: blockNames.length ? blockNames.length - 1 : null });
  }
  return { weeks, blockNames };
}

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

