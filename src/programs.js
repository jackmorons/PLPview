// Program management rules (spec §3.6): revisions, what carries over on update, change summary.
// Called by library.js, which loads and saves the records. Pure: no DOM, no Capacitor, so Vitest runs it.
//
// A saved program record:
//   { id, name, createdAt, revisions: [{revisionId, fileName, sha256, importedAt, model}], settings }
// The newest revision (last in the list) is the one shown. Revision models are schema 2 (model.js). Edited maxes and the last week/day are kept
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

/** Last week/day after an update, clamped to the new program: last week at most, and a day that exists that week. */
export function clampPosition(pos, model) {
  const ns = model.weeks.map((w) => w.n);
  const week = Math.min(Math.max(pos?.week || 1, ns[0]), ns[ns.length - 1]);
  const w = model.weeks.find((x) => x.n === week) || model.weeks[0];
  const letters = model.days.filter((d) => w.days.some((x) => x.letter === d));
  const day = letters.includes(pos?.day) ? pos.day : letters[0];
  return { week: w.n, day };
}

/**
 * What an update changes, shown before confirming. Sessions are compared week by week and day by day;
 * items are matched by kind + name (the n-th "panca" with the n-th "panca"), so a reordered day isn't "changed".
 *   weeks/blocks/days: [old, new] counts (days as letters)
 *   mainAdded/mainRemoved, accAdded/accRemoved: exercise names that appear or disappear across the program
 *   itemsChanged: matched items whose instructions, prescription, load, group or note differ
 *   itemsAdded/itemsRemoved: items that appear or disappear in weeks present in both
 */
export function changeSummary(oldM, newM) {
  const names = (m, kind) => new Set(m.weeks.flatMap((w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === kind).map((i) => i.name))));
  const diff = (a, b) => [...b].filter((x) => !a.has(x));
  const om = names(oldM, "main"), nm = names(newM, "main"), oa = names(oldM, "acc"), na = names(newM, "acc");

  let itemsChanged = 0, itemsAdded = 0, itemsRemoved = 0;
  const key = (i) => `${i.kind}|${i.name}`;
  for (const nw of newM.weeks) {
    const ow = oldM.weeks.find((w) => w.n === nw.n);
    if (!ow) continue;
    for (const letter of new Set([...ow.days, ...nw.days].map((d) => d.letter))) {
      const oi = ow.days.find((d) => d.letter === letter)?.items || [];
      const ni = nw.days.find((d) => d.letter === letter)?.items || [];
      const pool = new Map();
      for (const i of oi) pool.set(key(i), [...(pool.get(key(i)) || []), i]);
      for (const i of ni) {
        const match = pool.get(key(i))?.shift();
        if (!match) { itemsAdded++; continue; }
        if (JSON.stringify(match) !== JSON.stringify(i)) itemsChanged++;
      }
      for (const left of pool.values()) itemsRemoved += left.length;
    }
  }

  return {
    weeks: [oldM.weeks.length, newM.weeks.length],
    blocks: [(oldM.blocks || []).length, (newM.blocks || []).length],
    days: [oldM.days.join(""), newM.days.join("")],
    mainAdded: diff(om, nm),
    mainRemoved: diff(nm, om),
    accAdded: diff(oa, na),
    accRemoved: diff(na, oa),
    itemsChanged,
    itemsAdded,
    itemsRemoved,
  };
}

/** True when changeSummary found nothing (the file is different, e.g. a note, but the program isn't). */
export function isEmptySummary(s) {
  return s.weeks[0] === s.weeks[1] && s.blocks[0] === s.blocks[1] && s.days[0] === s.days[1] &&
    !s.mainAdded.length && !s.mainRemoved.length && !s.accAdded.length && !s.accRemoved.length &&
    !s.itemsChanged && !s.itemsAdded && !s.itemsRemoved;
}
