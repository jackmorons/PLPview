// The internal program model (see docs/PROGRAM-SCHEMA.md): the format the app stores and renders.
// The xlsx parser (parser.js) is only one way to produce it; v3's in-app editor will be another.
// Called by parser.js (validateProgram) and by storage.js on load (migrate). Pure: no DOM, no Capacitor.

export const SCHEMA_VERSION = 1;

export const PHASES = ["", "transizione", "entrata", "TEST"];

// Weeks with these phases get one accessory set less and RIR +1 (spec §3.4).
export const LIGHT_PHASES = ["transizione", "TEST"];

/** Lift id derived from its name: "Squat" → "squat". Names are unique (case-insensitive), so ids are too. */
export function liftId(name) {
  return String(name).trim().toLowerCase();
}

/**
 * Upgrades a saved model to SCHEMA_VERSION, one step at a time.
 * v1 has no older versions, so this only checks the version. Never break a saved program:
 * when v2 changes the schema, add a `if (m.schemaVersion === 1) { ...; m.schemaVersion = 2 }` step here.
 */
export function migrate(model) {
  const v = model?.schemaVersion;
  if (!Number.isInteger(v)) throw new Error("Programma senza schemaVersion");
  if (v > SCHEMA_VERSION) {
    throw new Error(`Programma salvato con una versione più recente dell'app (schema ${v}): aggiorna l'app`);
  }
  return model;
}

/**
 * Every rule that does not depend on the file format. Returns a list of {path, msg}.
 * `path` points into the model (e.g. "weeks.4.number"); the parser turns it into a cell reference.
 */
export function validateProgram(m) {
  const errors = [];
  const err = (path, msg) => errors.push({ path, msg });

  // Lifts: at least one, unique names, max > 0.
  if (!m.lifts?.length) err("lifts", "nessuna alzata con massimale");
  const seen = new Set();
  (m.lifts || []).forEach((l, i) => {
    if (!l.name) err(`lifts.${i}.name`, "nome dell'alzata vuoto");
    if (seen.has(l.id)) err(`lifts.${i}.name`, `alzata "${l.name}" ripetuta`);
    seen.add(l.id);
    if (!(typeof l.max === "number" && l.max > 0)) err(`lifts.${i}.max`, "il massimale deve essere un numero maggiore di 0");
  });

  // Days: single capital letters.
  (m.days || []).forEach((d, i) => {
    if (!/^[A-Z]$/.test(d)) err(`days.${i}`, `giorno "${d}" non valido: serve una sola lettera maiuscola`);
  });

  // Slots: a day that exists, a name.
  (m.slots || []).forEach((s, i) => {
    if (!s.name) err(`slots.${i}.name`, "nome dello slot vuoto");
    if (!m.days?.includes(s.day)) err(`slots.${i}.day`, `giorno "${s.day}" non presente`);
  });

  // Blocks: at least one, each with one variant per slot and at least one week.
  if (!m.blocks?.length) err("blocks", "nessun blocco");
  (m.blocks || []).forEach((b, bi) => {
    if (!b.name) err(`blocks.${bi}.name`, "nome del blocco vuoto");
    if (b.variants?.length !== m.slots?.length) err(`blocks.${bi}.variants`, "numero di varianti diverso dal numero di slot");
    if (!(m.weeks || []).some((w) => w.block === bi)) err(`blocks.${bi}.name`, `il blocco "${b.name}" non ha settimane`);
  });

  // Weeks: numbered 1, 2, 3… with blocks in non-decreasing order.
  if (!m.weeks?.length) err("weeks", "nessuna settimana");
  (m.weeks || []).forEach((w, i) => {
    if (w.number !== i + 1) err(`weeks.${i}.number`, `settimana ${w.number}: attesa la settimana ${i + 1} (devono essere consecutive da 1)`);
    if (!Number.isInteger(w.block) || w.block < 0 || w.block >= (m.blocks?.length || 0)) err(`weeks.${i}.number`, "settimana senza blocco");
    else if (i > 0 && w.block < m.weeks[i - 1].block) err(`weeks.${i}.number`, "blocchi fuori ordine");
  });

  // Prescriptions: one row per week, one cell per slot; load tokens point at existing lifts.
  if (m.prescriptions?.length !== m.weeks?.length) err("prescriptions", "numero di righe di prescrizioni diverso dal numero di settimane");
  (m.prescriptions || []).forEach((row, wi) => {
    if (row.length !== m.slots?.length) err(`prescriptions.${wi}`, "numero di prescrizioni diverso dal numero di slot");
    row.forEach((rx, si) => {
      if (rx == null) return;
      for (const p of rx.parts) {
        if (typeof p === "string") continue;
        if (!seen.has(p.lift)) err(`prescriptions.${wi}.${si}`, `carico riferito a un'alzata inesistente ("${p.lift}")`);
        if (!(p.pct > 0)) err(`prescriptions.${wi}.${si}`, "percentuale non valida");
        if (!(p.step > 0)) err(`prescriptions.${wi}.${si}`, "arrotondamento non valido");
      }
    });
  });

  // Accessories: valid day, a name, one integer ≥ 0 per block.
  (m.accessories || []).forEach((a, i) => {
    if (!m.days?.includes(a.day)) err(`accessories.${i}.day`, `giorno "${a.day}" non valido`);
    if (!a.name) err(`accessories.${i}.name`, "esercizio senza nome");
    if (a.sets?.length !== m.blocks?.length) err(`accessories.${i}.sets`, `servono ${m.blocks?.length} valori di serie (uno per blocco)`);
    (a.sets || []).forEach((s, bi) => {
      if (!(Number.isInteger(s) && s >= 0)) err(`accessories.${i}.sets.${bi}`, "le serie devono essere un intero ≥ 0");
    });
  });

  return errors;
}
