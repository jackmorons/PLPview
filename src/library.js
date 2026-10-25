// The app's data: every saved program, the active one, edited maxes, last week/day per program.
// Called by the UI (main.js and ui/*). Saves through a storage adapter (storage.js in the app,
// an in-memory one in the tests) and applies the rules from programs.js.
//
// Saved files:
//   state.json            {active, positions: {<programId>: {week, day}}}
//   programs/<id>.json    the program record with its revisions (programs.js)
//   maxes/<id>.json       maxes edited in the app, {liftId: kg}; missing lifts use the file's value
//   files/<revisionId>.xlsx  the original file of each revision, for "Esporta file originale"
import { parseXlsx } from "./parser.js";
import { migrate } from "./model.js";
import {
  newProgram, newRevision, addRevision, restoreRevision, currentRevision, findBySha, displayName,
  carryMaxes, clampPosition, changeSummary,
} from "./programs.js";

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLibrary(store, deps = {}) {
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const now = deps.now || (() => new Date().toISOString());

  let programs = []; // records, in creation order
  let state = { active: null, positions: {} };
  const maxes = {}; // programId → edited maxes

  const saveState = () => store.writeJSON("state.json", state);
  const saveProgram = (p) => store.writeJSON(`programs/${p.id}.json`, p);
  const put = (p) => { programs = programs.map((x) => (x.id === p.id ? p : x)); };

  const lib = {
    async load() {
      state = { active: null, positions: {}, ...(await store.readJSON("state.json")) };
      programs = [];
      for (const f of await store.list("programs")) {
        const p = await store.readJSON(`programs/${f}`);
        if (!p) continue;
        p.revisions.forEach((r) => migrate(r.model));
        programs.push(p);
        maxes[p.id] = (await store.readJSON(`maxes/${p.id}.json`)) || {};
      }
      programs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!programs.some((p) => p.id === state.active)) state.active = programs[0]?.id ?? null;
    },

    programs: () => programs,
    get: (id) => programs.find((p) => p.id === id) || null,
    active: () => lib.get(state.active),
    model: (id) => currentRevision(lib.get(id)).model,
    editedMaxes: (id) => maxes[id] || {},

    position(id) {
      return clampPosition(state.positions[id], lib.model(id));
    },
    async setPosition(id, pos) {
      state.positions[id] = pos;
      await saveState();
    },
    async setActive(id) {
      state.active = id;
      await saveState();
    },

    async setMax(id, liftId, kg) {
      maxes[id] = { ...maxes[id], [liftId]: kg };
      await store.writeJSON(`maxes/${id}.json`, maxes[id]);
    },
    async resetMaxes(id) {
      maxes[id] = {};
      await store.remove(`maxes/${id}.json`);
    },

    /**
     * Step 1 of every import: hash, look for duplicates, parse. Saves nothing.
     * Returns {sha256, duplicate, parsed, sameName} for the UI to decide what to ask.
     */
    async analyze(file) {
      const sha256 = await sha256Hex(file.bytes);
      const duplicate = findBySha(programs, sha256);
      const parsed = duplicate ? null : parseXlsx(file.bytes);
      const sameName = programs.find((p) => p.name === displayName(file.name)) || null;
      return { file, sha256, duplicate, parsed, sameName };
    },

    /** Saves an analyzed, valid file as a new program. Doesn't change the active program. */
    async create(a) {
      const revision = newRevision({ fileName: a.file.name, sha256: a.sha256, model: a.parsed.model, now: now(), id: uuid() });
      const p = newProgram({ id: uuid(), revision, now: now() });
      await store.writeBytes(`files/${revision.revisionId}.xlsx`, a.file.bytes);
      await saveProgram(p);
      programs.push(p);
      maxes[p.id] = {};
      return p;
    },

    /** What updating program `id` with an analyzed file would change. */
    preview(id, a) {
      return changeSummary(lib.model(id), a.parsed.model);
    },

    /** Stores the file as the program's new current revision and carries over maxes and position. */
    async update(id, a) {
      const revision = newRevision({ fileName: a.file.name, sha256: a.sha256, model: a.parsed.model, now: now(), id: uuid() });
      await store.writeBytes(`files/${revision.revisionId}.xlsx`, a.file.bytes);
      await lib._commitRevision(id, (p) => addRevision(p, revision));
    },

    /** Makes an old revision current again, as a new revision on top. */
    async restore(id, revisionId) {
      const newId = uuid();
      const bytes = await store.readBytes(`files/${revisionId}.xlsx`);
      if (bytes) await store.writeBytes(`files/${newId}.xlsx`, bytes);
      await lib._commitRevision(id, (p) => restoreRevision(p, revisionId, { id: newId, now: now() }));
    },

    async _commitRevision(id, change) {
      const { program, dropped } = change(lib.get(id));
      const model = currentRevision(program).model;
      for (const r of dropped) await store.remove(`files/${r.revisionId}.xlsx`);
      maxes[id] = carryMaxes(maxes[id], model);
      await store.writeJSON(`maxes/${id}.json`, maxes[id]);
      if (state.positions[id]) state.positions[id] = clampPosition(state.positions[id], model);
      put(program);
      await saveProgram(program);
      await saveState();
    },

    async rename(id, name) {
      const p = { ...lib.get(id), name: name.trim() || lib.get(id).name };
      put(p);
      await saveProgram(p);
    },

    async setPriorityGroups(id, groups) {
      const p = lib.get(id);
      const np = { ...p, settings: { ...p.settings, priorityGroups: groups } };
      put(np);
      await saveProgram(np);
    },

    /** A full copy under a new id: revisions, original files, maxes. */
    async duplicate(id) {
      const src = lib.get(id);
      const revisions = [];
      for (const r of src.revisions) {
        const nr = { ...r, revisionId: uuid() };
        const bytes = await store.readBytes(`files/${r.revisionId}.xlsx`);
        if (bytes) await store.writeBytes(`files/${nr.revisionId}.xlsx`, bytes);
        revisions.push(nr);
      }
      const p = { ...structuredClone(src), id: uuid(), name: `${src.name} (copia)`, createdAt: now(), revisions };
      programs.push(p);
      await saveProgram(p);
      maxes[p.id] = { ...maxes[id] };
      await store.writeJSON(`maxes/${p.id}.json`, maxes[p.id]);
      if (state.positions[id]) state.positions[p.id] = { ...state.positions[id] };
      await saveState();
      return p;
    },

    /** Removes the program, all its revisions, original files and maxes. */
    async remove(id) {
      const p = lib.get(id);
      for (const r of p.revisions) await store.remove(`files/${r.revisionId}.xlsx`);
      await store.remove(`programs/${id}.json`);
      await store.remove(`maxes/${id}.json`);
      programs = programs.filter((x) => x.id !== id);
      delete maxes[id];
      delete state.positions[id];
      if (state.active === id) state.active = programs[0]?.id ?? null;
      await saveState();
    },

    originalFile: (revisionId) => store.readBytes(`files/${revisionId}.xlsx`),
  };
  return lib;
}
