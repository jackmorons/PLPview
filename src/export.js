// Program model → workbook description, in either import format (v2: "Esporta come xlsx" and the templates).
// The description is plain data (sheets, rows, cells, dropdowns); xlsx-write.js turns it into bytes.
// Called by ui/programs.js and scripts/make-templates.js. Pure: no DOM, no Capacitor, no ExcelJS.
//
// Loads are written as real MROUND formulas on Massimali, with the kg Excel would show already filled in.
// The Massimali values are the file's maxes (lift.defaultMax), not the ones edited in the app.
// Every export is checked by the tests: importing it again gives back the same program.
import { expandV1, LIGHT_TYPES } from "./model.js";
import { render, maxesFor } from "./resolve.js";
import { FORMAT_VERSION } from "./parser.js";

const FIRST_LIFT_ROW = 3; // Massimali: title in A1, empty row 2, lifts from row 3 (as PL28)
const MAX_LITERAL = 255; // Excel's limit for one "string" inside a formula
const MAIN_BY_NAME = /^(squat|panca|stacco|trazioni)\b/; // same rule as parse-coach.js

const LOAD_HELP = 'Carico dai massimali: ="4x5 "&MROUND(Massimali!$B$3*0.57,2.5)&"kg" (riga 3 = prima alzata, 0.57 = 57%, arrotondato a 2,5), oppure testo con segnaposto: 4x5 {Squat .57}kg';
const TYPE_HELP = "Tipo di settimana: normale (o vuoto), scarico, transizione, ramping, intensificazione, picco, taper, entrata, test, gara";

/** Which formats a program can be exported to: [{format, ok, reason}]. Coach always works. */
export function exportFormats(m) {
  const v1 = toV1(m);
  return [
    { format: "pl28", ok: !v1.error, reason: v1.error || null },
    { format: "coach", ok: true, reason: null },
  ];
}

/** The workbook description for `format` ("pl28" or "coach"). Throws if the program doesn't fit PL28. */
export function exportProgram(m, format) {
  if (format === "coach") return coachWorkbook(m);
  const v1 = toV1(m);
  if (v1.error) throw new Error(v1.error);
  return pl28Workbook(v1, m);
}

// ---------------------------------------------------------------- cells

/** A template → a cell: null (empty), plain text, or a formula with its cached text. */
function templateCell(tpl, maxes) {
  if (tpl == null) return null;
  if (tpl.parts.every((p) => typeof p === "string")) return tpl.parts.join("");
  const terms = [];
  for (const p of tpl.parts) {
    if (typeof p !== "string") {
      terms.push(`MROUND(Massimali!$B$${FIRST_LIFT_ROW + maxes.index[p.lift]}*${p.pct},${p.step})`);
      continue;
    }
    for (let i = 0; i < p.length; i += MAX_LITERAL) terms.push(`"${p.slice(i, i + MAX_LITERAL).replace(/"/g, '""')}"`);
  }
  return { f: terms.join("&"), v: render(tpl, maxes.kg) };
}

/** Lift id → row offset, and the file's maxes for the cached values. */
function liftMaxes(m) {
  return { index: Object.fromEntries(m.lifts.map((l, i) => [l.id, i])), kg: maxesFor(m) };
}

function metaSheet() {
  return { name: "meta", cols: [16, 6], rows: [["formatVersion", FORMAT_VERSION]] };
}

function noteSheet(m) {
  return { name: "note", cols: [110], rows: m.notes.map((t) => [t]) };
}

function massimaliSheet(m) {
  const last = FIRST_LIFT_ROW + m.lifts.length - 1;
  return {
    name: "Massimali",
    cols: [30, 10],
    rows: [
      [{ v: "Massimali di riferimento (kg)", bold: true }],
      [],
      ...m.lifts.map((l) => [l.name, { v: l.defaultMax, input: true }]),
      [{ v: "Totale", bold: true }, { f: `SUM(B${FIRST_LIFT_ROW}:B${last})`, v: m.lifts.reduce((a, l) => a + l.defaultMax, 0) }],
    ],
  };
}

// ---------------------------------------------------------------- coach format

/**
 * Coach format (FORMAT-COACH.md): every session in `training log`. `overall` holds the week types, dates,
 * named blocks and one column per main-lift position; the log's main rows point at those cells (=overall!D3).
 */
function coachWorkbook(m) {
  const maxes = liftMaxes(m);

  // overall columns: the n-th main lift of a day. Header = its first name; lift type = the first one given.
  const slots = [];
  for (const day of m.days) {
    for (const w of m.weeks) {
      const mains = w.days.find((d) => d.letter === day)?.items.filter((i) => i.kind === "main") || [];
      mains.forEach((it, k) => {
        let s = slots.find((x) => x.day === day && x.k === k);
        if (!s) slots.push((s = { day, k, name: it.name, rx: it.prescription, liftType: null }));
        s.liftType ??= it.liftType;
      });
    }
  }
  // Grouped by lift (Squat A, C, D, then Panca…), then by day.
  slots.sort((a, b) => liftRank(m, a.name, a.rx) - liftRank(m, b.name, b.rx) || m.days.indexOf(a.day) - m.days.indexOf(b.day) || a.k - b.k);
  const slotCol = (day, k) => 4 + slots.findIndex((s) => s.day === day && s.k === k); // D onwards

  const ov = [overallHeader(slots.map((s) => `${s.name} (${s.day})`)), liftTypeRow(slots.map((s) => s.liftType))];
  const ovRow = {}; // week n → overall row number
  let block = null;
  for (const w of m.weeks) {
    if (w.block != null && w.block !== block) {
      block = w.block;
      // Variant row: A empty, block name in B, the block's first instructions under each column.
      const first = m.weeks.find((x) => x.block === block);
      ov.push([null, { v: m.blocks[block].name, bold: true }, null, ...slots.map((s) => mainAt(first, s.day, s.k)?.instructions ?? null)]);
    }
    const row = [w.n, w.dates, w.type === "normale" ? null : w.type, ...slots.map(() => null)];
    for (const s of slots) row[slotCol(s.day, s.k) - 1] = templateCell(mainAt(w, s.day, s.k)?.prescription ?? null, maxes);
    ov.push(row);
    ovRow[w.n] = ov.length;
  }

  const log = [["Settimana", "Giorno", "Alzata", "Istruzioni", "Serie x rep", "kg/RPE", "carico usato", "Difficoltà", "Note", "Gruppo"].map(header)];
  for (const w of m.weeks) {
    for (const d of w.days) {
      if (log.length > 1) log.push([]); // a blank row between days, as in PL27
      const mains = d.items.filter((i) => i.kind === "main");
      for (const it of d.items) {
        const k = mains.indexOf(it);
        const rx = it.kind === "main" && it.prescription
          ? { f: `overall!${colName(slotCol(d.letter, k))}${ovRow[w.n]}`, v: render(it.prescription, maxes.kg) }
          : templateCell(it.prescription, maxes);
        log.push([w.n, d.letter, it.name, it.instructions, rx, templateCell(it.load, maxes), null, null,
          templateCell(it.note, maxes), groupCell(it)]);
      }
    }
  }

  const days = m.days.join(",");
  return {
    sheets: [
      noteSheet(m),
      ...(m.lifts.length ? [massimaliSheet(m)] : []),
      overallSheet(ov),
      {
        name: "training log", cols: [10, 8, 26, 28, 26, 14, 12, 12, 30, 20], freeze: 1, rows: log,
        notes: { E1: `${LOAD_HELP}. Oppure un riferimento a overall: =overall!D3` },
        validations: [{ range: "B2:B5000", list: days, strict: false }],
      },
      metaSheet(),
    ],
  };
}

/**
 * Where a lift column goes when columns are grouped by lift: the index of the Massimali lift its name starts with
 * ("Panca var." → Panca), else of the first lift its loads use; columns of no lift (Trazioni) go last.
 */
function liftRank(m, name, rx) {
  const n = name.toLowerCase();
  let i = m.lifts.findIndex((l) => n.startsWith(l.id) && !/[\p{L}\d]/u.test(n[l.id.length] || ""));
  if (i < 0) {
    const token = rx?.parts.find((p) => typeof p !== "string");
    i = token ? m.lifts.findIndex((l) => l.id === token.lift) : -1;
  }
  return i < 0 ? m.lifts.length : i;
}

function mainAt(w, day, k) {
  return w.days.find((d) => d.letter === day)?.items.filter((i) => i.kind === "main")[k] || null;
}

/** Column J. A main lift is "Fondamentale"; without a group, an accessory leaves J empty. */
function groupCell(it) {
  if (it.kind === "main") return it.group ?? (MAIN_BY_NAME.test(it.name.toLowerCase()) ? null : "Fondamentale");
  return it.group;
}

// ---------------------------------------------------------------- PL28 format

/**
 * Model → the PL28 sheets' shape (schema 1: slots × weeks, accessories with sets per block), or {error}.
 * The PL28 format can't say everything the model can (accessories that change inside a block, notes…),
 * so the result is checked by expanding it again: it must give back exactly the same program.
 */
export function toV1(m) {
  const no = (why) => ({ error: `Il formato PL28 non può descrivere questo programma: ${why}. Esportalo in formato coach.` });
  if (!m.lifts.length) return no("non ha massimali");
  if (!m.blocks?.length || m.weeks.some((w) => w.block == null)) return no("alcune settimane non sono in un blocco");

  const days = [...m.days].sort(); // the PL28 parser lists days alphabetically
  const dayOf = (w, letter) => w.days.find((d) => d.letter === letter)?.items || [];

  // Main lifts: one column per (day, name), in the order they appear.
  let slots = [];
  for (const day of days) {
    const keys = mergeOrders(m.weeks.map((w) => keyed(dayOf(w, day).filter((i) => i.kind === "main"), (i) => i.name)));
    for (const key of keys) slots.push({ day, key, name: key.slice(0, key.lastIndexOf("#")) });
  }
  const slotItem = (w, s) => keyedMap(dayOf(w, s.day).filter((i) => i.kind === "main"), (i) => i.name).get(s.key);
  for (const s of slots) {
    const items = m.weeks.map((w) => slotItem(w, s)).filter(Boolean);
    s.type = items.map((i) => i.liftType).find((t) => t) || null;
    s.rank = liftRank(m, s.name, items.find((i) => i.prescription)?.prescription);
  }
  // Columns grouped by lift, then by day. A day's lifts are listed in column order, so this is only possible when
  // it keeps every day's own order; otherwise the columns stay grouped by day.
  const byLift = slots.map((s, i) => ({ s, i })).sort((a, b) => a.s.rank - b.s.rank || days.indexOf(a.s.day) - days.indexOf(b.s.day) || a.i - b.i).map((x) => x.s);
  const order = (list, day) => list.filter((s) => s.day === day).map((s) => s.key).join("|");
  if (days.every((d) => order(byLift, d) === order(slots, d))) slots = byLift;

  const blocks = m.blocks.map((b, bi) => {
    const ws = m.weeks.filter((w) => w.block === bi);
    return { name: b.name, variants: slots.map((s) => ws.map((w) => slotItem(w, s)?.instructions).find((x) => x) || "") };
  });
  const prescriptions = m.weeks.map((w) => slots.map((s) => slotItem(w, s)?.prescription ?? null));

  // Accessories: one row per exercise with the same day, name, instructions, group, reps and intensity.
  const accessories = [];
  for (const day of days) {
    const rowsOf = (w) => keyed(dayOf(w, day).filter((i) => i.kind === "acc").map((i) => accRow(i, LIGHT_TYPES.includes(w.type))),
      (a) => (a ? JSON.stringify([a.name, a.instructions, a.group, a.reps, a.intensity]) : "?"));
    const keys = mergeOrders(m.weeks.map((w) => rowsOf(w).map((x) => x.key)));
    for (const key of keys) {
      if (key.startsWith("?")) return no("un accessorio non è scritto come «serie x rep»");
      const sets = m.blocks.map((_, bi) => {
        // A normal week of the block gives the sets; a light week has one less.
        let best = null;
        for (const w of m.weeks.filter((x) => x.block === bi)) {
          const r = rowsOf(w).find((x) => x.key === key)?.row;
          if (!r) continue;
          if (!r.light) return r.sets;
          best ??= r.sets;
        }
        return best ?? 0;
      });
      const [name, instructions, group, reps, intensity] = JSON.parse(key.slice(0, key.lastIndexOf("#")));
      accessories.push({ day, name, instructions, group, reps, intensity, sets, volumeOnly: false });
    }
  }

  const v1 = {
    lifts: m.lifts.map((l) => ({ id: l.id, name: l.name, defaultMax: l.defaultMax })),
    blocks,
    weeks: m.weeks.map((w) => ({ number: w.n, type: w.type, block: w.block, dates: w.dates })),
    days,
    slots: slots.map(({ name, day, type }) => ({ name, day, type })),
    prescriptions,
    accessories,
    notes: m.notes,
  };
  if (!sameProgram(expandV1(v1), m)) return no("cambia accessori, varianti o note all'interno di un blocco");
  return v1;
}

/**
 * An accessory item → its accessori row fields, undoing the light-week −1 set / RIR +1. null if it doesn't fit.
 * Notes are left out: in this format they are the reminders expandV1 adds, and the final check catches any other.
 */
function accRow(it, light) {
  const rx = it.prescription?.parts || [];
  const m = typeof rx[0] === "string" && /^(\d+)x(.*)$/s.exec(rx[0]);
  if (!m) return null;
  const reps = [m[2], ...rx.slice(1)].filter((p) => p !== "");
  let intensity = it.load;
  if (light && intensity?.parts.every((p) => typeof p === "string")) intensity = { parts: [rirMinusOne(intensity.parts.join(""))] };
  return {
    name: it.name, instructions: it.instructions || "", group: it.group || "",
    reps: reps.length ? { parts: reps } : null, intensity, sets: +m[1] + (light ? 1 : 0), light,
  };
}

/** "RIR 2-3" → "RIR 1-2": the reverse of model.js rirPlusOne. */
function rirMinusOne(s) {
  return /^RIR\b/.test(s) ? s.replace(/\d+/g, (n) => String(+n - 1)) : s;
}

/** Items → [{key, row}] where key = keyOf(row) + "#" + how many times that key came before (so duplicates stay apart). */
function keyed(rows, keyOf) {
  const seen = {};
  return rows.map((row) => {
    const k = keyOf(row);
    seen[k] = (seen[k] || 0) + 1;
    return { key: `${k}#${seen[k]}`, row };
  });
}

function keyedMap(items, keyOf) {
  return new Map(keyed(items, keyOf).map((x) => [x.key, x.row]));
}

/** Several orderings of keys → one list that keeps each one's order where possible. */
function mergeOrders(lists) {
  const out = [];
  for (const list of lists) {
    let at = 0;
    for (const x of list) {
      const key = typeof x === "string" ? x : x.key;
      const i = out.indexOf(key);
      if (i >= 0) at = i + 1;
      else out.splice(at++, 0, key);
    }
  }
  return out;
}

/** True when two models describe the same program (key order and the `format` field don't matter). */
export function sameProgram(a, b) {
  return canonical({ ...a, format: null }) === canonical({ ...b, format: null });
}

function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}`;
  return JSON.stringify(x ?? null);
}

/** PL28 format (FORMAT.md): Massimali + overall (slots × weeks) + accessori (sets per block). */
function pl28Workbook(v1, m) {
  const maxes = liftMaxes(m);
  const ov = [overallHeader(v1.slots.map((s) => `${s.name} (${s.day})`)), liftTypeRow(v1.slots.map((s) => s.type))];
  v1.blocks.forEach((b, bi) => {
    ov.push([null, { v: b.name, bold: true }, null, ...b.variants.map((x) => x || null)]);
    v1.weeks.forEach((w, wi) => {
      if (w.block !== bi) return;
      ov.push([w.number, w.dates, w.type === "normale" ? null : w.type, ...v1.prescriptions[wi].map((t) => templateCell(t, maxes))]);
    });
  });

  const weeksOf = (bi) => v1.weeks.filter((w) => w.block === bi).map((w) => w.number);
  const acc = [[...["Giorno", "Esercizio", "Istruzioni", "Gruppo", "Rep", "Intensità"],
    ...v1.blocks.map((_, bi) => `Serie B${bi + 1} (sett ${weeksOf(bi)[0]}-${weeksOf(bi).at(-1)})`)].map(header)];
  for (const a of v1.accessories) {
    acc.push([a.day, a.name, a.instructions || null, a.group || null, templateCell(a.reps, maxes), templateCell(a.intensity, maxes), ...a.sets]);
  }

  return {
    sheets: [
      noteSheet(m),
      massimaliSheet(m),
      overallSheet(ov),
      {
        name: "accessori", cols: [8, 26, 30, 18, 10, 12, ...v1.blocks.map(() => 18)], freeze: 1, rows: acc,
        notes: {
          E1: `Rep e Intensità possono contenere carichi. ${LOAD_HELP}`,
          G1: "Una colonna «Serie B…» per blocco di overall. Nelle settimane transizione/scarico/test l'app toglie 1 serie e aggiunge 1 al RIR.",
        },
        validations: [{ range: "A2:A400", list: v1.days.join(","), strict: false }],
      },
      metaSheet(),
    ],
  };
}

const TYPES = "normale,scarico,transizione,ramping,intensificazione,picco,taper,entrata,test,gara";

const LIFT_TYPES = "stressante,rigenerante,tecnica,stimolo,volume";

/** Row 1 of the shared `overall` layout (FORMAT.md): week | giorno (dates) | tipo | one column per lift. */
function overallHeader(lifts) {
  return ["week", "giorno", "tipo", ...lifts].map(header);
}

/** Row 2: "tipo alzata" and each lift column's type (stressante, rigenerante…), empty where there's none. */
function liftTypeRow(types) {
  return [{ v: "tipo alzata", bold: true }, null, null, ...types];
}

function overallSheet(rows) {
  const last = colName(rows[0].length);
  return {
    name: "overall", cols: [11, 26, 16, ...rows[0].slice(3).map(() => 24)], freeze: 2, rows,
    notes: {
      A1: "Riga con A vuota = nuovo blocco: nome in B, varianti sotto le alzate.", B1: "Date della settimana (testo libero, facoltativo).",
      C1: TYPE_HELP, D1: LOAD_HELP,
      A2: "Tipo di ogni alzata (facoltativo, testo libero): stressante, rigenerante, tecnica… L'app lo mostra accanto al nome.",
    },
    validations: [
      { range: "C3:C400", list: TYPES, strict: true },
      ...(rows[0].length > 3 ? [{ range: `D2:${last}2`, list: LIFT_TYPES, strict: false }] : []),
    ],
  };
}

function header(v) {
  return { v, bold: true, header: true };
}

function colName(c) {
  let s = "";
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}
