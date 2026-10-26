// The two empty templates ("Scarica template"): a one-block, one-week example program exported in the
// PL28 or the coach format, with filling instructions in the `note` sheet and the cells to edit in yellow.
// Built from the same exporter as "Esporta come xlsx", so a template always matches the parser.
// Called by ui/programs.js and scripts/make-templates.js. Pure: no DOM, no Capacitor.
import { expandV1 } from "./model.js";
import { exportProgram } from "./export.js";

export const TEMPLATE_NAMES = { pl28: "PL-template-PL28.xlsx", coach: "PL-template-coach.xlsx" };

const load = (lift, pct) => ({ lift, pct, step: 2.5 });

/** The example program (schema 2). Squat / Panca / Stacco, days A–C, one block of one week. */
export function exampleModel() {
  return expandV1({
    lifts: [{ id: "squat", name: "Squat", defaultMax: 180 }, { id: "panca", name: "Panca", defaultMax: 120 }, { id: "stacco", name: "Stacco", defaultMax: 210 }],
    blocks: [{ name: "Blocco 1 – ESEMPIO", variants: ["no var.", "fermo 1''", "no var.", "presa stretta"] }],
    weeks: [{ number: 1, type: "normale", block: 0 }],
    days: ["A", "B", "C"],
    slots: [
      { name: "Squat", day: "A", type: "stressante" }, { name: "Panca", day: "A", type: "stressante" },
      { name: "Stacco", day: "B", type: "stressante" }, { name: "Panca var.", day: "C", type: "rigenerante" },
    ],
    prescriptions: [[
      { parts: ["4x5 ", load("squat", 0.75), "kg"] },
      { parts: ["5x5 ", load("panca", 0.72), "kg"] },
      { parts: ["4@7 + 90% 3x4"] },
      { parts: [load("panca", 0.65), "kg 30-35RT"] },
    ]],
    accessories: [
      { day: "A", name: "Affondi", instructions: "manubri", group: "Femorali/glutei", reps: "8-10", intensity: "RIR 2", sets: [3] },
      { day: "B", name: "Rematore", instructions: "", group: "Dorsali", reps: "10-12", intensity: "RIR 1-2", sets: [3] },
      { day: "C", name: "Curl", instructions: "", group: "Bicipiti", reps: "10-12", intensity: "RIR 1", sets: [3] },
    ],
    notes: [],
  });
}

const NOTES = {
  pl28: [
    "Template PL – formato PL28 (accessori uguali per tutto il blocco)",
    "",
    "COME SI COMPILA",
    "• Le righe gialle sono un esempio: sostituiscile con il tuo programma. Il file importato così com'è è un programma valido di 1 settimana.",
    "• Massimali: nome in colonna A, massimale in colonna B, dalla riga 3. Le formule puntano alla riga: Massimali!$B$3 = prima alzata.",
    "• overall, riga 1: week | giorno | tipo | una colonna per alzata \"Nome (giorno)\", es. \"Squat (A)\", raggruppate per alzata (Squat A, Squat C… poi Panca). Le colonne vuote fanno da separatore.",
    "• overall, riga 2 (facoltativa): \"tipo alzata\" in A e sotto ogni alzata il suo tipo (stressante, rigenerante, tecnica…, testo libero). L'app lo mostra accanto al nome.",
    "• overall, riga di blocco: A vuota, nome del blocco in B, varianti sotto ogni alzata. Righe di settimana: numero in A (1, 2, 3… senza buchi), date in B (facoltative), tipo in C, prescrizioni.",
    "• Righe vuote tra i blocchi vanno bene; due righe vuote di fila chiudono il foglio.",
    "• Tipo di settimana (menu a tendina): normale (o vuoto), scarico, transizione, ramping, intensificazione, picco, taper, entrata, test, gara.",
    "• Prescrizioni: testo libero; carichi con la formula =\"4x5 \"&MROUND(Massimali!$B$3*0.75,2.5)&\"kg\" oppure col segnaposto 4x5 {Squat .75}kg. Cella vuota = alzata non fatta quella settimana.",
    "• accessori: Giorno | Esercizio | Istruzioni | Gruppo | Rep | Intensità, poi una colonna \"Serie B…\" per blocco (intero, 0 = non fatto). Rep e Intensità possono contenere carichi, come le prescrizioni.",
    "• Nelle settimane transizione, scarico e test l'app toglie 1 serie agli accessori e aggiunge 1 al RIR.",
    "• Non unire celle. Il foglio meta indica la versione del formato: non toccarlo.",
  ],
  coach: [
    "Template PL – formato coach (ogni sessione scritta per intero)",
    "",
    "COME SI COMPILA",
    "• Le righe gialle sono un esempio: sostituiscile con il tuo programma. Il file importato così com'è è un programma valido di 1 settimana.",
    "• training log: una riga per esercizio. Settimana | Giorno (una lettera) | Alzata | Istruzioni | Serie x rep | kg/RPE | carico usato | Difficoltà | Note | Gruppo.",
    "• carico usato e Difficoltà sono per l'atleta: l'app li ignora. Una riga vuota tra i giorni va bene.",
    "• Gruppo: Fondamentale per le alzate principali, altrimenti il gruppo muscolare (serve per i gruppi prioritari).",
    "• Carichi: formula =\"4x5 \"&MROUND(Massimali!$B$3*0.75,2.5)&\"kg\", segnaposto 4x5 {Squat .75}kg, oppure un riferimento a overall (=overall!D3).",
    "• La prima nota di un giorno diventa il suo banner nell'app.",
    "• overall (facoltativo): week | giorno (date) | tipo | colonne delle alzate, come nel formato PL28. Riga 2 facoltativa \"tipo alzata\": il tipo di ogni colonna (stressante, rigenerante…) vale per le righe del training log che puntano a quella colonna. Una riga con A vuota apre un blocco: nome in B, varianti sotto le alzate. Due righe vuote di fila chiudono il foglio.",
    "• Tipo di settimana (menu a tendina): normale (o vuoto), scarico, transizione, ramping, intensificazione, picco, taper, entrata, test, gara. In questo formato il tipo non cambia le serie.",
    "• Massimali (facoltativo): nome in A, massimale in B dalla riga 3. Senza Massimali i carichi sono testo fisso.",
    "• Non unire celle. Il foglio meta indica la versione del formato: non toccarlo.",
  ],
};

/** The template's workbook description for "pl28" or "coach". */
export function templateWorkbook(format) {
  const wb = exportProgram({ ...exampleModel(), format }, format);
  for (const s of wb.sheets) {
    if (s.name === "note") s.rows = NOTES[format].map((t) => [t || null]);
    if (!["overall", "accessori", "training log"].includes(s.name)) continue;
    // Every example cell, filled or not, is yellow: it's what gets replaced.
    const width = s.rows[0].length;
    s.rows = s.rows.map((row, ri) => (ri === 0 || !row.length ? row
      : Array.from({ length: width }, (_, ci) => yellow(row[ci]))));
  }
  return wb;
}

function yellow(c) {
  if (c == null) return { v: null, input: true };
  return typeof c === "object" ? { ...c, input: true } : { v: c, input: true };
}
