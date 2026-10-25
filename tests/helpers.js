// Test helpers: fixture loading, the prototype's own resolve() logic, and broken copies of PL28.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseXlsx } from "../src/parser.js";

export const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

export const PL27_MEET = { squat: 192.5, panca: 130, stacco: 220 };

/** The prototype's embedded `const DATA = {...}`. */
export function prototypeData() {
  const html = fixture("PL28_standalone.html").toString("utf8");
  return JSON.parse(/const DATA = (\{.*?\});\n/.exec(html)[1]);
}

/** Copy of the prototype's it()/mround()/resolve(), with its S/B/D letters mapped to our lift ids. */
export function prototypeResolve(s, maxes) {
  const it = (n) => (Math.round(n * 100) / 100).toString().replace(".", ",");
  const mround = (x) => Math.round(x / 2.5) * 2.5;
  const max = { S: maxes.squat, B: maxes.panca, D: maxes.stacco };
  return s.replace(/\{([SBD])(\.\d+)\}/g, (m, l, p) => it(mround(max[l] * parseFloat(p))));
}

/** PL28 parsed, as a test fixture. */
export const pl28 = () => model("PL28.xlsx");

/** Read a fixture, let `edit(wb)` change it, write it back to xlsx bytes and parse those bytes. */
export function parseEdited(name, edit) {
  return parseXlsx(editedBytes(name, edit));
}

export function editedBytes(name, edit) {
  const wb = XLSX.read(fixture(name), { type: "buffer", cellFormula: true });
  edit(wb);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

export const parseEditedPL28 = (edit) => parseEdited("PL28.xlsx", edit);

/** Parse a fixture that must import cleanly; returns the model. */
export function model(name) {
  const r = parseXlsx(fixture(name));
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.ref}: ${e.msg}`).join("\n"));
  return r.model;
}

/** Find the slot item of a PL28-format session: `header` like "Squat stress (A)". */
export function slotItem(m, week, header) {
  const [, name, day] = /^(.+?) \(([A-Z])\)$/.exec(header);
  const d = m.weeks.find((w) => w.n === week).days.find((x) => x.letter === day);
  return d?.items.find((i) => i.kind === "main" && i.name === name) ?? null;
}

/** PL28 bytes after `edit(wb)`, as a file the library can import. */
export const editedPL28Bytes = (edit) => editedBytes("PL28.xlsx", edit);

/** Removes a whole row's cells from a sheet and shrinks its range (for "one week removed"). */
export function dropLastRow(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = range.s.c; c <= range.e.c; c++) delete ws[XLSX.utils.encode_cell({ r: range.e.r, c })];
  range.e.r--;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

/** In-memory storage with the same interface as src/storage.js. */
export function memoryStore() {
  const m = new Map();
  return {
    data: m,
    readJSON: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    writeJSON: async (k, v) => { m.set(k, JSON.stringify(v)); },
    readBytes: async (k) => m.get(k) ?? null,
    writeBytes: async (k, b) => { m.set(k, new Uint8Array(b)); },
    remove: async (k) => { m.delete(k); },
    list: async (folder) => [...m.keys()].filter((k) => k.startsWith(folder + "/")).map((k) => k.slice(folder.length + 1)),
  };
}
