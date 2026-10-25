// Generates examples/example.xlsx: a small, complete program in import format v1 (docs/FORMAT.md),
// to send to people as a starting point. 10 weeks, 3 days, squat / bench / deadlift only.
// Run with `npm run example`. Not part of the app; tests/example.test.js checks the output imports cleanly.
//
// Every load is a real MROUND formula, and its cached value is filled in, so Excel, Numbers and
// Google Sheets show the kg straight away. One cell uses a text placeholder ({Panca .65}) to show that option.
import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIFTS = [["Squat", 180], ["Panca", 120], ["Stacco", 210]]; // Massimali rows 3, 4, 5
const ROW = { S: 3, P: 4, D: 5 };
const MAX = { S: 180, P: 120, D: 210 };
const fmt = (n) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const mround = (x) => Math.round(x / 2.5) * 2.5;

/** Template string → formula cell. "4x5 [S.75]kg" = 4x5 + MROUND(Massimali!$B$3*0.75,2.5) + "kg". */
function rx(t) {
  if (t == null) return null; // empty: not trained that week (hidden in the app)
  if (!/\[[SPD]\.\d+\]/.test(t)) return { t: "s", v: t }; // plain text, shown as written
  const terms = [];
  let value = "";
  let last = 0;
  for (const m of t.matchAll(/\[([SPD])(\.\d+)\]/g)) {
    const before = t.slice(last, m.index);
    if (before) { terms.push(`"${before.replace(/"/g, '""')}"`); value += before; }
    terms.push(`MROUND(Massimali!$B$${ROW[m[1]]}*0${m[2]},2.5)`);
    value += fmt(mround(MAX[m[1]] * parseFloat(m[2])));
    last = m.index + m[0].length;
  }
  const after = t.slice(last);
  if (after) { terms.push(`"${after.replace(/"/g, '""')}"`); value += after; }
  return { t: "s", f: terms.join("&"), v: value };
}

// ---- overall: one column per slot, "Name (Day)"
const SLOTS = ["Squat (A)", "Panca (A)", "Stacco (B)", "Panca volume (B)", "Squat volume (C)", "Panca var. (C)", "Stacco var. (C)"];
const BLOCKS = [
  { name: "Blocco 1 – Accumulo", variants: ["no var.", "fermo 1''", "no var.", "presa stretta", "discesa 3''", "larsen", "RDL"],
    weeks: [
      ["", ["4x6 [S.70]kg", "5x5 [P.70]kg", "4@7 + 90% 3x4", "{Panca .65}kg 30-35RT", "3x8 [S.60]kg", "4x6 @7", "3x8 [D.50]kg"]],
      ["", ["4x5 [S.74]kg", "5x5 [P.73]kg", "4x4 [D.75]kg", "[P.68]kg 30-35RT", "3x8 [S.62]kg", "4x6 @7", "3x8 [D.525]kg"]],
      ["", ["4x4 [S.78]kg", "5x4 [P.77]kg", "4x3 [D.79]kg", "[P.70]kg 25-30RT", "3x6 [S.65]kg", "4x5 @7/8", "3x6 [D.55]kg"]],
      ["", ["4x3 [S.82]kg + ist.", "5x3 [P.80]kg", "3x3 [D.83]kg", "[P.72]kg 25-30RT", "3x6 [S.67]kg", "4x5 @7/8", "3x6 [D.575]kg"]],
      ["transizione", ["3x3 [S.72]kg", "3x3 [P.72]kg", "3x2 @7", "[P.65]kg 20RT", "2x6 [S.60]kg", "3x5 @6", null]],
    ] },
  { name: "Blocco 2 – Intensificazione", variants: ["no var.", "no var.", "no var.", "presa stretta", "fermo in buca 2''", "spoto", "deficit 3cm"],
    weeks: [
      ["", ["1@8 + 90% 3x3", "1x1 [P.88]kg + 4x3 [P.83]kg", "[D.85]kg 15-20RT", "[P.73]kg 25-30RT", "4x4 [S.68]kg", "4x4 @7", "3x4 [D.65]kg"]],
      ["", ["1@8 + 90% 3x2", "1x1 [P.90]kg + 4x2 [P.85]kg", "5x2 [D.87]kg", "[P.75]kg 20-25RT", "4x3 [S.70]kg", "4x3 @7", "3x3 [D.675]kg"]],
      ["", ["4x2 [S.87]kg", "6x2 [P.86]kg", "EMOM 8 [D.80]kg", "[P.77]kg 20RT", "3x3 [S.72]kg", "4x3 @7/8", "3x3 [D.70]kg"]],
      ["", ["1@9 + 85% 2x2", "1@8/9 + 90% 3x2", "3x1 [D.90]kg @8", "[P.70]kg 15RT", "3x2 [S.70]kg", "3x2 @7", null]],
      ["test", ["TEST", "TEST", "TEST", null, "—", "—", null]],
    ] },
];

const ov = [["week", "fase", ...SLOTS]];
let week = 0;
for (const b of BLOCKS) {
  ov.push([null, b.name, ...b.variants]);
  for (const [phase, cells] of b.weeks) ov.push([++week, phase || null, ...cells]);
}
const overall = XLSX.utils.aoa_to_sheet(ov);
// Write the prescription cells (formulas and text) by hand, so formulas keep their `f`.
ov.forEach((r, ri) => {
  if (ri === 0 || r[0] == null) return;
  r.slice(2).forEach((t, ci) => {
    const ref = XLSX.utils.encode_cell({ r: ri, c: ci + 2 });
    const cell = rx(t);
    if (cell) overall[ref] = cell;
    else delete overall[ref];
  });
});
overall["!cols"] = [{ wch: 6 }, { wch: 26 }, ...SLOTS.map(() => ({ wch: 24 }))];

// ---- Massimali: title, lifts on rows 3-5, Totale
const massimali = XLSX.utils.aoa_to_sheet([["Massimali di riferimento (kg)"], [], ...LIFTS, ["Totale"]]);
massimali.B6 = { t: "n", f: "SUM(B3:B5)", v: LIFTS.reduce((a, [, kg]) => a + kg, 0) };
massimali["!cols"] = [{ wch: 30 }, { wch: 10 }];

// ---- accessori: required, here with headers only (this example has no accessories)
const accessori = XLSX.utils.aoa_to_sheet([["Giorno", "Esercizio", "Istruzioni", "Gruppo", "Rep", "Intensità", "Serie B1", "Serie B2"]]);
accessori["!cols"] = [{ wch: 8 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 9 }, { wch: 9 }];

// ---- note: shown in the app's Note tab
const note = XLSX.utils.aoa_to_sheet([
  ["Esempio – 10 settimane, 3 giorni, solo squat / panca / stacco"],
  [],
  ["COME È FATTO"],
  ["• Massimali: nome in colonna A, massimale in colonna B (righe 3-5). Cambiali e tutti i kg in overall si ricalcolano, arrotondati a 2,5 kg."],
  ["• overall: riga 1 = intestazioni \"Nome (giorno)\". Una riga con A vuota e il nome del blocco in B apre un blocco e contiene le varianti; le righe con il numero di settimana in A contengono le prescrizioni."],
  ["• Fase in colonna B: vuota, transizione, entrata o TEST. Cella vuota = alzata non fatta quella settimana."],
  ["• Carichi: formula =\"4x5 \"&MROUND(Massimali!$B$3*0.75,2.5)&\"kg\", oppure testo con segnaposto {Squat .75}kg."],
  ["• accessori: obbligatorio, anche vuoto. Una colonna \"Serie B…\" per blocco."],
  [],
  ["STRUTTURA"],
  ["• Blocco 1 (sett. 1-5): accumulo, volume in calo e intensità in salita; settimana 5 di transizione."],
  ["• Blocco 2 (sett. 6-10): intensificazione con top set a RPE e back-off; settimana 10 TEST."],
]);
note["!cols"] = [{ wch: 110 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, note, "note");
XLSX.utils.book_append_sheet(wb, massimali, "Massimali");
XLSX.utils.book_append_sheet(wb, overall, "overall");
XLSX.utils.book_append_sheet(wb, accessori, "accessori");

const out = fileURLToPath(new URL("../examples/example.xlsx", import.meta.url));
mkdirSync(fileURLToPath(new URL("../examples/", import.meta.url)), { recursive: true });
writeFileSync(out, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("Scritto", out);
