// Program model + current maxes → what the session view shows: strings, plates, banners.
// Called by the UI on every render, so edited maxes recalculate every load. Pure: no DOM, no Capacitor.

export const DEFAULT_PLATES = { bar: 20, collar: 0, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };

/** Week types: short label for the week button, and the one-line meaning shown as a banner. */
export const WEEK_TYPE_INFO = {
  normale: { label: "", title: "Normale", meaning: "" },
  scarico: { label: "SCAR", title: "Scarico", meaning: "Scarico: volume e intensità nettamente ridotti." },
  transizione: { label: "TRANS", title: "Transizione", meaning: "Transizione: settimana leggera tra due blocchi." },
  ramping: { label: "RAMP", title: "Ramping", meaning: "Ramping: intensità in salita settimana dopo settimana, verso un carico pesante." },
  intensificazione: { label: "INT", title: "Intensificazione", meaning: "Intensificazione: intensità alta, volume più basso." },
  picco: { label: "PICCO", title: "Picco", meaning: "Picco: i singoli più pesanti del blocco." },
  taper: { label: "TAPER", title: "Taper", meaning: "Taper: riduzione del carico prima della gara." },
  entrata: { label: "ENTR", title: "Entrata", meaning: "Entrata: prova delle aperture." },
  test: { label: "TEST", title: "Test", meaning: "Test: settimana di test dei massimali." },
  gara: { label: "GARA", title: "Gara", meaning: "Gara: settimana di gara." },
};

/** Italian number format: 112.5 → "112,5". Rounded to 2 decimals, no trailing zeros (as the prototype). */
export function fmt(n) {
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}

/** Excel's MROUND for positive numbers. Excel rounds halves away from zero; for x > 0 that is Math.round. */
export function mround(x, step) {
  return Math.round(x / step) * step;
}

/** {liftId: max} from the file's defaults, overridden by the maxes edited in the app. */
export function maxesFor(model, edited = {}) {
  const out = {};
  for (const l of model.lifts) out[l.id] = typeof edited[l.id] === "number" && edited[l.id] > 0 ? edited[l.id] : l.defaultMax;
  return out;
}

export function loadKg(token, maxes) {
  return mround(maxes[token.lift] * token.pct, token.step);
}

/** A template ({parts}) → the string shown, e.g. "4x5 + ist. 110kg". null stays null. */
export function render(tpl, maxes) {
  if (tpl == null) return null;
  return tpl.parts.map((p) => (typeof p === "string" ? p : fmt(loadKg(p, maxes)))).join("");
}

/** Heaviest "<n>kg" in a display string (for the plate diagram), 0 if none. */
export function topKg(s) {
  const re = /(\d+(?:,\d+)?)\s?kg/g;
  let m;
  let best = 0;
  while ((m = re.exec(s || ""))) best = Math.max(best, parseFloat(m[1].replace(",", ".")));
  return best;
}

/**
 * Plates per side for a total load. Greedy, heaviest first.
 * Returns null if the load is lighter than bar + collars; `rest` is what the available plates can't make.
 */
export function platesPerSide(kg, opts = DEFAULT_PLATES) {
  let side = (kg - opts.bar - 2 * opts.collar) / 2;
  if (side < -1e-9) return null;
  const plates = [];
  for (const w of [...opts.plates].sort((a, b) => b - a)) {
    while (side >= w - 1e-9) { plates.push(w); side -= w; }
  }
  return { plates, rest: Math.max(0, Math.round(side * 100) / 100) };
}

export function week(model, n) {
  return model.weeks.find((w) => w.n === n) || null;
}

/** The day letters of a week, in the program's day order. */
export function daysOf(model, n) {
  const w = week(model, n);
  return w ? model.days.filter((d) => w.days.some((x) => x.letter === d)) : [];
}

/** "Squat stress · Panca var. · Trazioni" for that week's day, or "Ipertrofia / accessori" without main lifts. */
export function daySubtitle(model, n, letter) {
  const d = week(model, n)?.days.find((x) => x.letter === letter);
  const names = (d?.items || []).filter((i) => i.kind === "main").map((i) => i.name);
  return names.length ? names.join(" · ") : d ? "Ipertrofia / accessori" : "";
}

/** Every (week, day) that exists, in order, for prev/next and swipe. */
export function sessionOrder(model) {
  return model.weeks.flatMap((w) => daysOf(model, w.n).map((d) => ({ week: w.n, day: d })));
}

/** Week number → block, or null (coach files without overall have no blocks). */
export function blockOf(model, n) {
  return (model.blocks || []).find((b) => n >= b.firstWeek && n <= b.lastWeek) || null;
}

/**
 * Everything the session view needs for one week and day. null if that day isn't in that week.
 * The day's first note becomes its banner (and isn't repeated under its item); other notes stay with their item.
 */
export function session(model, n, letter, maxes) {
  const w = week(model, n);
  const d = w?.days.find((x) => x.letter === letter);
  if (!d) return null;

  let banner = null;
  const items = d.items.map((it) => {
    const text = render(it.prescription, maxes);
    const load = render(it.load, maxes);
    let note = render(it.note, maxes);
    if (note && banner == null) { banner = note; note = null; }
    return {
      kind: it.kind,
      name: it.name,
      instructions: it.instructions,
      liftType: it.liftType ?? null,
      group: it.group,
      text,
      load,
      note,
      kg: topKg(text) || topKg(load),
      // Pull-up loads are added to bodyweight: no barbell plates.
      plates: it.kind === "main" && !it.name.trim().toLowerCase().startsWith("trazioni"),
    };
  });

  return {
    week: w.n,
    day: letter,
    type: w.type,
    typeInfo: WEEK_TYPE_INFO[w.type] || WEEK_TYPE_INFO.normale,
    dates: w.dates,
    blockName: blockOf(model, n)?.name || null,
    banner,
    mains: items.filter((i) => i.kind === "main"),
    accessories: items.filter((i) => i.kind === "acc"),
  };
}
