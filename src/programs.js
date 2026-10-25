// Program management rules (spec §3.6): revisions, what carries over on update, change summary.
// Called by library.js, which loads and saves the records. Pure: no DOM, no Capacitor, so Vitest runs it.
//
// A saved program record:
//   { id, name, createdAt, revisions: [{revisionId, fileName, sha256, importedAt, model}], settings }
// The newest revision (last in the list) is the one shown. Edited maxes and the last week/day are kept
// outside the record (maxes/<id>.json, state.json) and adjusted with carryMaxes() / clampPosition().

export const MAX_REVISIONS = 5;

export const DEFAULT_PRIORITY_GROUPS = [
  "Dorsali", "Bicipiti", "Serrato", "Avambracci/presa", "Femorali/glutei", "Core laterale/rotazionale",
];

/** "PL28.xlsx" → "PL28". */
export function displayName(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

export function currentRevision(program) {
  return program.revisions[program.revisions.length - 1];
}

export function newRevision({ fileName, sha256, model, now, id }) {
  return { revisionId: id, fileName, sha256, importedAt: now, model };
}

/** A new program from its first revision. The id is random, never derived from the file. */
export function newProgram({ id, revision, now }) {
  return {
    id,
    name: displayName(revision.fileName),
    createdAt: now,
    revisions: [revision],
    settings: { priorityGroups: [...DEFAULT_PRIORITY_GROUPS] },
  };
}

/** Adds a revision as the current one and keeps only the newest MAX_REVISIONS. Returns {program, dropped}. */
export function addRevision(program, revision) {
  const all = [...program.revisions, revision];
  const dropped = all.slice(0, Math.max(0, all.length - MAX_REVISIONS));
  return { program: { ...program, revisions: all.slice(-MAX_REVISIONS) }, dropped };
}

/** Restoring copies an old revision to the top, so nothing is lost and the history grows by one. */
export function restoreRevision(program, revisionId, { id, now }) {
  const old = program.revisions.find((r) => r.revisionId === revisionId);
  if (!old) throw new Error("Revisione non trovata");
  return addRevision(program, { ...old, revisionId: id, importedAt: now, restoredFrom: revisionId });
}

/** The program and revision that already hold a file with this hash, or null. */
export function findBySha(programs, sha256) {
  for (const p of programs) {
    const r = p.revisions.find((x) => x.sha256 === sha256);
    if (r) return { program: p, revision: r };
  }
  return null;
}

/** Edited maxes after an update: kept for lifts that still exist (same name), dropped for removed lifts. */
export function carryMaxes(edited, newModel) {
  const ids = new Set(newModel.lifts.map((l) => l.id));
  return Object.fromEntries(Object.entries(edited || {}).filter(([id]) => ids.has(id)));
}

/** Last week/day after an update, clamped to the new program. */
export function clampPosition(pos, model) {
  const last = model.weeks[model.weeks.length - 1].number;
  const week = Math.min(Math.max(pos?.week || 1, 1), last);
  const day = model.days.includes(pos?.day) ? pos.day : model.days[0];
  return { week, day };
}

/**
 * What an update changes, shown before confirming (spec §4 P0.9):
 * weeks/blocks/days, main-lift slots added/removed, prescription cells changed, accessories added/removed.
 */
export function changeSummary(oldM, newM) {
  const header = (s) => `${s.name} (${s.day})`;
  const oldSlots = oldM.slots.map(header);
  const newSlots = newM.slots.map(header);
  const accKey = (a) => `${a.day} · ${a.name}`;
  const oldAcc = oldM.accessories.map(accKey);
  const newAcc = newM.accessories.map(accKey);

  // Changed cells: same slot header and same week number in both, different content.
  let cellsChanged = 0;
  newM.weeks.forEach((w, nwi) => {
    const owi = oldM.weeks.findIndex((x) => x.number === w.number);
    if (owi < 0) return;
    newSlots.forEach((h, nsi) => {
      const osi = oldSlots.indexOf(h);
      if (osi < 0) return;
      if (JSON.stringify(oldM.prescriptions[owi][osi]) !== JSON.stringify(newM.prescriptions[nwi][nsi])) cellsChanged++;
    });
  });

  return {
    weeks: [oldM.weeks.length, newM.weeks.length],
    blocks: [oldM.blocks.length, newM.blocks.length],
    days: [oldM.days.join(""), newM.days.join("")],
    slotsAdded: newSlots.filter((h) => !oldSlots.includes(h)),
    slotsRemoved: oldSlots.filter((h) => !newSlots.includes(h)),
    cellsChanged,
    accessoriesAdded: newAcc.filter((k) => !oldAcc.includes(k)),
    accessoriesRemoved: oldAcc.filter((k) => !newAcc.includes(k)),
  };
}

/** True when changeSummary found nothing (the file is different, e.g. a note, but the program isn't). */
export function isEmptySummary(s) {
  return s.weeks[0] === s.weeks[1] && s.blocks[0] === s.blocks[1] && s.days[0] === s.days[1] &&
    !s.slotsAdded.length && !s.slotsRemoved.length && !s.cellsChanged &&
    !s.accessoriesAdded.length && !s.accessoriesRemoved.length;
}
