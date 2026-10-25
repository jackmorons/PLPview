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
export function pl28() {
  const r = parseXlsx(fixture("PL28.xlsx"));
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.ref}: ${e.msg}`).join("\n"));
  return r.model;
}

/** Read PL28, let `edit(wb)` break it, write it back to xlsx bytes and parse those bytes. */
export function parseEditedPL28(edit) {
  const wb = XLSX.read(fixture("PL28.xlsx"), { type: "buffer", cellFormula: true });
  edit(wb);
  return parseXlsx(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

/** PL28 bytes after `edit(wb)`, as a file the library can import. */
export function editedPL28Bytes(edit) {
  const wb = XLSX.read(fixture("PL28.xlsx"), { type: "buffer", cellFormula: true });
  edit(wb);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

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
