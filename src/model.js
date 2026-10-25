// The internal program model (docs/PROGRAM-SCHEMA.md): the format the app stores and renders.
// Both xlsx formats are converted into it (parse-pl28.js, parse-coach.js); v3's editor will write it directly.
// Called by the parsers (validateProgram, expandV1) and by library.js on load (migrate).
// Pure: no DOM, no Capacitor.
//
// Schema 2 stores every session explicitly: weeks[].days[].items[]. That is what lets the coach format
// change accessories, sets and reps from week to week. The PL28 format (accessories per block) is expanded
// into the same shape by expandV1(), which is also how schema-1 programs saved earlier are upgraded.

export const SCHEMA_VERSION = 2;

/** Week types (FORMAT-COACH-SPEC.md §9): one fixed list for both formats. "normale" = no badge. */
export const WEEK_TYPES = ["normale", "scarico", "transizione", "ramping", "intensificazione", "picco", "taper", "entrata", "test", "gara"];

/** In the PL28 format only, these types get one accessory set less and RIR +1. The coach format writes sets out. */
export const LIGHT_TYPES = ["transizione", "scarico", "test"];

/** Lift id derived from its name: "Squat" → "squat". Names are unique (case-insensitive), so ids are too. */
export function liftId(name) {
  return String(name).trim().toLowerCase();
}

/** "TEST" → "test", "" → "normale"; null if it isn't a known type. */
export function weekType(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "normale";
  return WEEK_TYPES.includes(v) ? v : null;
}

/** "RIR 1-2" → "RIR 2-3". Other intensities ("@7", "—") are returned unchanged. */
export function rirPlusOne(s) {
  return /^RIR\b/.test(s) ? s.replace(/\d+/g, (n) => String(+n + 1)) : s;
}

const text = (s) => (s ? { parts: [s] } : null);

/**
 * PL28-format data (schema 1: slots × weeks + accessories per block) → schema 2 sessions.
 * Days are listed in the model's day order; a day with nothing in it that week is left out.
 */
export function expandV1(v1) {
  const weeks = v1.weeks.map((w, wi) => {
    const type = w.type ?? weekType(w.phase) ?? "normale";
    const light = LIGHT_TYPES.includes(type);
    const days = [];
    for (const letter of v1.days) {
      const items = [];
      v1.slots.forEach((slot, si) => {
        const rx = v1.prescriptions[wi][si];
        if (slot.day !== letter || rx == null) return;
        items.push({ kind: "main", name: slot.name, instructions: v1.blocks[w.block].variants[si] || null,
          prescription: rx, load: null, group: "Fondamentale", note: null });
      });
      for (const a of v1.accessories) {
        if (a.day !== letter || a.volumeOnly) continue;
        const sets = a.sets[w.block] - (light ? 1 : 0);
        if (sets <= 0) continue;
        items.push({ kind: "acc", name: a.name, instructions: a.instructions || null,
          prescription: { parts: [`${sets}x${a.reps}`] }, load: text(light ? rirPlusOne(a.intensity) : a.intensity),
          group: a.group || null, note: null });
      }
      if (!items.length) continue;
      // The PL28 format has no notes column: the reminders it used to compute become the day's first note.
      const notes = [];
      if (light && v1.accessories.some((a) => a.day === letter)) notes.push("Accessori già scalati di 1 serie: tieni RIR +1.");
      if (!items.some((i) => i.kind === "main")) notes.push(accessoryDayReminder(v1, letter));
      if (notes.length) items[0] = { ...items[0], note: text(notes.join(" · ")) };
      days.push({ letter, items });
    }
    return { n: w.number, type, dates: null, block: w.block, days };
  });

  const blocks = v1.blocks.map((b, bi) => {
    const ws = weeks.filter((w) => w.block === bi);
    return { name: b.name, firstWeek: ws[0].n, lastWeek: ws[ws.length - 1].n };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    format: "pl28",
    lifts: v1.lifts.map((l) => ({ id: l.id, name: l.name, defaultMax: l.max ?? l.defaultMax })),
    days: [...v1.days],
    weeks,
    blocks,
    notes: v1.notes || [],
  };
}

/**
 * PL28's "never E the day before B or D": B and D are the deadlift days. The reminder names the days
 * with a slot starting with "Stacco"; with none it stays generic.
 */
function accessoryDayReminder(v1, day) {
  const heavy = v1.days.filter((d) => v1.slots.some((s) => s.day === d && s.name.startsWith("Stacco")));
  if (!heavy.length) return `Fai ${day} solo se domani non c’è una sessione pesante.`;
  const list = heavy.length === 1 ? heavy[0] : `${heavy.slice(0, -1).join(", ")} o ${heavy[heavy.length - 1]}`;
  return `Fai ${day} solo se domani non c’è ${list}.`;
}

/**
 * Upgrades a saved model to SCHEMA_VERSION, one step at a time. Never break a saved program:
 * add a step for each new version, never edit an old one.
 */
export function migrate(model) {
  let m = model;
  if (!Number.isInteger(m?.schemaVersion)) throw new Error("Programma senza schemaVersion");
  if (m.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Programma salvato con una versione più recente dell'app (schema ${m.schemaVersion}): aggiorna l'app`);
  }
  if (m.schemaVersion === 1) m = expandV1(m); // 1 → 2: accessories per block → explicit sessions
  return m;
}

/**
 * Every rule that does not depend on the file format. Returns a list of {path, msg}.
 * `path` points into the model (e.g. "weeks.4.days.0.items.2"); the parser turns it into a cell reference.
 */
export function validateProgram(m) {
  const errors = [];
  const err = (path, msg) => errors.push({ path, msg });

  const ids = new Set();
  (m.lifts || []).forEach((l, i) => {
    if (!l.name) err(`lifts.${i}.name`, "nome dell'alzata vuoto");
    if (ids.has(l.id)) err(`lifts.${i}.name`, `alzata "${l.name}" ripetuta`);
    ids.add(l.id);
    if (!(typeof l.defaultMax === "number" && l.defaultMax > 0)) err(`lifts.${i}.max`, "il massimale deve essere un numero maggiore di 0");
  });

  (m.days || []).forEach((d, i) => {
    if (!/^[A-Z]$/.test(d)) err(`days.${i}`, `giorno "${d}" non valido: serve una sola lettera`);
  });

  if (!m.weeks?.length) err("weeks", "nessuna settimana");
  (m.weeks || []).forEach((w, wi) => {
    if (w.n !== wi + 1) err(`weeks.${wi}.n`, `settimana ${w.n}: attesa la settimana ${wi + 1} (devono essere consecutive da 1)`);
    if (!WEEK_TYPES.includes(w.type)) err(`weeks.${wi}.type`, `tipo di settimana "${w.type}" non valido`);
    if (!w.days.length) err(`weeks.${wi}.n`, `la settimana ${w.n} non ha giorni`);
    const seen = new Set();
    w.days.forEach((d, di) => {
      if (seen.has(d.letter)) err(`weeks.${wi}.days.${di}`, `giorno ${d.letter} ripetuto nella settimana ${w.n}`);
      seen.add(d.letter);
      if (!m.days?.includes(d.letter)) err(`weeks.${wi}.days.${di}`, `giorno ${d.letter} non presente nell'elenco dei giorni`);
      d.items.forEach((it, ii) => {
        const p = `weeks.${wi}.days.${di}.items.${ii}`;
        if (!it.name) err(`${p}.name`, "esercizio senza nome");
        if (it.kind !== "main" && it.kind !== "acc") err(p, `tipo di esercizio "${it.kind}" non valido`);
        for (const [field, tpl] of [["prescription", it.prescription], ["load", it.load], ["note", it.note]]) {
          for (const part of tpl?.parts || []) {
            if (typeof part === "string") continue;
            if (!ids.has(part.lift)) err(`${p}.${field}`, `carico riferito a un'alzata inesistente ("${part.lift}")`);
            if (!(part.pct > 0) || !(part.step > 0)) err(`${p}.${field}`, "percentuale o arrotondamento non validi");
          }
        }
      });
    });
  });

  const last = m.weeks?.length || 0;
  let prev = 0;
  (m.blocks || []).forEach((b, bi) => {
    if (!(b.firstWeek >= 1 && b.lastWeek >= b.firstWeek && b.lastWeek <= last && b.firstWeek > prev)) {
      err(`blocks.${bi}`, `il blocco "${b.name}" ha settimane non valide`);
    }
    prev = b.lastWeek;
  });

  return errors;
}
