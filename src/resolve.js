// Program model + current maxes → what the session view shows: prescription strings, accessory sets,
// plates per side. Called by the UI on every render, so edited maxes recalculate every load.
// Pure: no DOM, no Capacitor, so Vitest runs it in Node.
import { LIGHT_PHASES } from "./model.js";

export const DEFAULT_PLATES = { bar: 20, collar: 0, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };

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
  for (const l of model.lifts) out[l.id] = typeof edited[l.id] === "number" && edited[l.id] > 0 ? edited[l.id] : l.max;
  return out;
}

/** The kg of one load token. */
export function loadKg(token, maxes) {
  return mround(maxes[token.lift] * token.pct, token.step);
}

/** A prescription ({parts}) → the string shown, e.g. "4x5 + ist. 110kg". null stays null (hidden). */
export function renderRx(rx, maxes) {
  if (rx == null) return null;
  return rx.parts.map((p) => (typeof p === "string" ? p : fmt(loadKg(p, maxes)))).join("");
}

/** Heaviest "<n>kg" in a display string (for the plate diagram), 0 if none. */
export function topKg(s) {
  const re = /(\d+(?:,\d+)?)kg/g;
  let m;
  let best = 0;
  while ((m = re.exec(s))) best = Math.max(best, parseFloat(m[1].replace(",", ".")));
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

export function isLightPhase(phase) {
  return LIGHT_PHASES.includes(phase);
}

/** "Squat stress · Panca var. · Trazioni", or "Ipertrofia / accessori" for a day with no main lifts. */
export function daySubtitle(model, day) {
  const names = model.slots.filter((s) => s.day === day).map((s) => s.name);
  return names.length ? names.join(" · ") : "Ipertrofia / accessori";
}

/** Every (week, day) in order, for prev/next and swipe. */
export function sessionOrder(model) {
  return model.weeks.flatMap((w) => model.days.map((d) => ({ week: w.number, day: d })));
}

/**
 * Everything the session view needs for one week and day.
 * Main lifts with an empty cell are hidden; accessories get one set less in light weeks and
 * disappear at 0; volume-only rows (intensity "vedi overall") are not listed.
 */
export function session(model, weekNumber, day, maxes) {
  const wi = model.weeks.findIndex((w) => w.number === weekNumber);
  const week = model.weeks[wi];
  const light = isLightPhase(week.phase);

  const mains = [];
  model.slots.forEach((slot, si) => {
    if (slot.day !== day) return;
    const rx = model.prescriptions[wi][si];
    if (rx == null) return;
    const text = renderRx(rx, maxes);
    mains.push({
      slot: si,
      name: slot.name,
      variant: model.blocks[week.block].variants[si],
      text,
      kg: topKg(text),
      // Pull-up loads are added to bodyweight: no barbell plates.
      plates: !slot.name.startsWith("Trazioni"),
    });
  });

  const accessories = model.accessories
    .filter((a) => a.day === day && !a.volumeOnly)
    .map((a) => ({ ...a, setsThisWeek: a.sets[week.block] - (light ? 1 : 0) }))
    .filter((a) => a.setsThisWeek > 0);

  return {
    week: week.number,
    day,
    block: week.block,
    blockName: model.blocks[week.block].name,
    phase: week.phase,
    light,
    mains,
    accessories,
    // Spec §4: the "day E" reminder applies to any day with accessories but no main lifts.
    accessoryOnly: model.slots.every((s) => s.day !== day) && model.accessories.some((a) => a.day === day),
  };
}
