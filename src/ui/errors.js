// The import errors screen (spec §4 P0.8): the full list from the parser, with sheet and cell, copyable.
// Called by ui/programs.js when a file is rejected. Nothing has been saved at that point.
import { formatIssue } from "../parser.js";
import { copyText } from "../native.js";
import { dialog, esc } from "./dom.js";

export async function showImportErrors(fileName, result) {
  const lines = result.errors.map(formatIssue);
  const warn = result.warnings.map(formatIssue);
  const text = [`${fileName}: ${lines.length} ${lines.length === 1 ? "errore" : "errori"}`, ...lines,
    ...(warn.length ? ["", "Avvisi:", ...warn] : [])].join("\n");
  await dialog({
    title: "File non importato",
    body: `
      <p><b>${esc(fileName)}</b> non rispetta il formato: ${lines.length === 1 ? "c'è 1 problema" : `ci sono ${lines.length} problemi`}.
      Il programma attuale non è stato toccato. Correggi il file e riprova.</p>
      <pre class="errlist">${esc(lines.join("\n"))}</pre>
      ${warn.length ? `<p>Avvisi (non bloccano l'import):</p><pre class="errlist">${esc(warn.join("\n"))}</pre>` : ""}
      <button class="btn" data-copy>Copia elenco</button>`,
    actions: [{ label: "Chiudi", value: true, kind: "primary" }],
    onOpen(box) {
      const b = box.querySelector("[data-copy]");
      b.onclick = async () => { b.textContent = (await copyText(text)) ? "Copiato ✓" : "Copia non riuscita: seleziona il testo"; };
    },
  });
}

/** After a successful import with warnings: list them, so nothing goes unnoticed. */
export async function showImportWarnings(fileName, warnings) {
  if (!warnings.length) return;
  await dialog({
    title: "Importato, con avvisi",
    body: `<p><b>${esc(fileName)}</b> è stato importato.</p><pre class="errlist">${esc(warnings.map(formatIssue).join("\n"))}</pre>`,
  });
}
