// The "Note" tab (spec §4 P0.6): the program's `note` sheet and the notation card.
// Called by main.js.
import { currentRevision } from "../programs.js";
import { esc } from "./dom.js";

const NOTATION = [
  ["RT", "Rep totali al carico, divise in serie come vuoi (es. 160kg 25-30RT)"],
  ["ist.", "Serie istintiva: le rep che ti senti, vicino a un AMRAP"],
  ["@7", "RPE 7; @7/8 = tra 7 e 8"],
  ["90%", "Percentuale del top set del giorno, non del massimale"],
  ["EMOM n", "Una ripetizione all’inizio di ogni minuto per n minuti"],
  ["MAV n", "Schema per le trazioni dai programmi precedenti"],
  ["no var.", "L’alzata di gara senza varianti"],
];

export function renderNote(el, ctx) {
  const p = ctx.lib.active();
  const notes = p ? currentRevision(p).model.notes : [];
  // A short line in capitals ("STRUTTURA", "REGOLE ACCESSORI") reads as a heading.
  const isHead = (t) => t.length < 60 && t === t.toUpperCase() && /[A-Z]/.test(t);

  el.innerHTML = `
    <div class="wrap">
      <h1 class="page-title">Note</h1>
      ${notes.length ? `<section class="card notes">${notes.map((t) => `<p${isHead(t) ? ' class="head"' : ""}>${esc(t)}</p>`).join("")}</section>` : ""}
      <section class="card">
        <h3>Notazione</h3>
        <dl class="notation">${NOTATION.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      </section>
    </div>`;
}
