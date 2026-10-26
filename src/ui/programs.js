// The "Programmi" tab (spec §4 P0.9) and the import / update flows, plus v2's templates, "Esporta come xlsx"
// and "Verifica file". Called by main.js. Data changes go through library.js; files come from native.js.
// xlsx-write.js (ExcelJS, ~1 MB) is loaded only when a file is written.
import { pickFile, shareFile } from "../native.js";
import { currentRevision, isEmptySummary } from "../programs.js";
import { parseXlsx, formatIssue } from "../parser.js";
import { exportFormats, exportProgram } from "../export.js";
import { templateWorkbook, TEMPLATE_NAMES } from "../templates.js";
import { dialog, notice, esc, date } from "./dom.js";
import { showImportErrors, showImportWarnings } from "./errors.js";

const FORMAT_LABEL = { pl28: "Formato PL28", coach: "Formato coach" };

export function renderPrograms(el, ctx) {
  const { lib } = ctx;
  const list = lib.programs();
  const activeId = lib.active()?.id;

  el.innerHTML = `
    <div class="wrap">
      <header class="top"><h1 class="page-title">Programmi</h1>
        <div class="row-btns">
          <button class="btn primary" data-import>Importa programma</button>
          <button class="btn" data-template>Scarica template…</button>
          <button class="btn" data-verify>Verifica file…</button>
        </div></header>
      ${list.length ? "" : `<div class="card empty-state"><h2>Nessun programma</h2>
        <p class="muted">Importa un file .xlsx nel formato PL per iniziare.</p></div>`}
      ${list.map((p) => {
        const r = currentRevision(p);
        const active = p.id === activeId;
        return `
          <section class="card prog${active ? " active" : ""}">
            <button class="prog-main" data-open="${p.id}" aria-label="${active ? "Programma attivo" : "Rendi attivo"}: ${esc(p.name)}">
              <div><h3>${esc(p.name)}</h3>
                <div class="muted">${r.model.weeks.length} settimane · ${r.model.days.length} giorni · ${r.model.format === "coach" ? "formato coach" : "formato PL28"}</div>
                <div class="muted">Aggiornato il ${date(r.importedAt)} · ${esc(r.fileName)}</div></div>
              ${active ? `<span class="badge">Attivo</span>` : `<span class="btn link">Attiva</span>`}
            </button>
            <div class="row-btns">
              <button class="btn" data-update="${p.id}">Aggiorna da xlsx…</button>
              <button class="btn" data-history="${p.id}">Revisioni (${p.revisions.length})</button>
              <button class="btn" data-more="${p.id}">Altro…</button>
            </div>
          </section>`;
      }).join("")}
    </div>`;

  el.querySelector("[data-import]").onclick = () => ctx.importProgram();
  el.querySelector("[data-template]").onclick = () => downloadTemplate();
  el.querySelector("[data-verify]").onclick = () => verifyFile();
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = async () => {
    await lib.setActive(b.dataset.open);
    ctx.go("session");
  }));
  el.querySelectorAll("[data-update]").forEach((b) => (b.onclick = () => updateProgram(ctx, b.dataset.update)));
  el.querySelectorAll("[data-history]").forEach((b) => (b.onclick = () => showHistory(ctx, b.dataset.history)));
  el.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => showMore(ctx, b.dataset.more)));
}

/** "Importa programma": pick, check, then add as new (or update a program with the same name). */
export async function importProgram(ctx) {
  const { lib } = ctx;
  const file = await pickFile();
  if (!file) return;
  const a = await lib.analyze(file);
  if (a.duplicate) return alreadyImported(ctx, a);
  if (!a.parsed.ok) return showImportErrors(file.name, a.parsed);

  if (a.sameName) {
    const choice = await dialog({
      title: `Esiste già «${a.sameName.name}»`,
      body: `<p>Vuoi aggiornare il programma esistente con questo file, o tenerli separati?</p>`,
      actions: [
        { label: `Aggiorna ${a.sameName.name}`, value: "update", kind: "primary" },
        { label: "Importa come nuovo programma", value: "new" },
        { label: "Annulla", value: null },
      ],
    });
    if (choice === "update") return confirmUpdate(ctx, a.sameName.id, a);
    if (choice !== "new") return;
  }

  const hadActive = lib.active();
  const p = await lib.create(a);
  await showImportWarnings(file.name, a.parsed.warnings);
  if (hadActive) {
    const go = await dialog({
      title: `«${p.name}» importato`,
      body: `<p>Ora il programma attivo è <b>${esc(hadActive.name)}</b>. Vuoi passare a <b>${esc(p.name)}</b>?</p>`,
      actions: [{ label: `Apri ${p.name}`, value: true, kind: "primary" }, { label: `Resta su ${hadActive.name}`, value: false }],
    });
    if (!go) return ctx.go("programs");
  }
  await lib.setActive(p.id);
  ctx.go("session");
}

/** "Aggiorna da xlsx…" on a program card. */
async function updateProgram(ctx, id) {
  const file = await pickFile();
  if (!file) return;
  const a = await ctx.lib.analyze(file);
  if (a.duplicate) return alreadyImported(ctx, a);
  if (!a.parsed.ok) return showImportErrors(file.name, a.parsed);
  return confirmUpdate(ctx, id, a);
}

/** Shows the change summary; on confirm stores the new revision (maxes and position carry over). */
async function confirmUpdate(ctx, id, a) {
  const { lib } = ctx;
  const p = lib.get(id);
  const s = lib.preview(id, a);
  const lines = [];
  const pair = ([x, y], what) => (x === y ? null : `${what}: ${x} → ${y}`);
  for (const l of [pair(s.weeks, "Settimane"), pair(s.blocks, "Blocchi"), pair(s.days, "Giorni")]) if (l) lines.push(esc(l));
  if (s.mainAdded.length) lines.push(`Fondamentali nuovi: ${esc(s.mainAdded.join(", "))}`);
  if (s.mainRemoved.length) lines.push(`Fondamentali spariti: ${esc(s.mainRemoved.join(", "))}`);
  if (s.accAdded.length) lines.push(`Accessori nuovi: ${esc(s.accAdded.join(", "))}`);
  if (s.accRemoved.length) lines.push(`Accessori spariti: ${esc(s.accRemoved.join(", "))}`);
  if (s.itemsChanged) lines.push(`Esercizi modificati: ${s.itemsChanged}`);
  if (s.itemsAdded) lines.push(`Esercizi aggiunti: ${s.itemsAdded}`);
  if (s.itemsRemoved) lines.push(`Esercizi tolti: ${s.itemsRemoved}`);

  const ok = await dialog({
    title: `Aggiorna ${p.name}`,
    body: `
      <p>Da <b>${esc(a.file.name)}</b>. Cosa cambia:</p>
      ${isEmptySummary(s) ? "<p>Nessuna differenza nel programma (il file è cambiato in fogli o celle che l’app non usa).</p>"
        : `<ul class="summary">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`}
      <p>I massimali modificati restano; la revisione attuale resta nella cronologia.</p>`,
    actions: [{ label: "Aggiorna", value: true, kind: "primary" }, { label: "Annulla", value: false }],
  });
  if (!ok) return;
  await lib.update(id, a);
  await showImportWarnings(a.file.name, a.parsed.warnings);
  ctx.go(lib.active()?.id === id ? "session" : "programs");
}

async function alreadyImported(ctx, a) {
  const { program, revision } = a.duplicate;
  const isCurrent = currentRevision(program).revisionId === revision.revisionId;
  const open = await dialog({
    title: "Già importato",
    body: `<p>Questo file è già in <b>${esc(program.name)}</b>${isCurrent ? "" : ` (revisione del ${date(revision.importedAt)})`}.</p>`,
    actions: [{ label: `Apri ${program.name}`, value: true, kind: "primary" }, { label: "Chiudi", value: false }],
  });
  if (!open) return;
  await ctx.lib.setActive(program.id);
  ctx.go("session");
}

/** Revision history: newest first, restore and export each one. */
async function showHistory(ctx, id) {
  const { lib } = ctx;
  const p = lib.get(id);
  const revs = [...p.revisions].reverse();
  const choice = await dialog({
    title: `Revisioni di ${p.name}`,
    body: `<p>Le ultime ${revs.length}. «Ripristina» rimette in uso una revisione come nuova revisione: non si perde niente.</p>
      <div class="revs">${revs.map((r, i) => `
        <div class="rev"><div><b>${date(r.importedAt)}</b> · ${esc(r.fileName)}${i === 0 ? " · <b>attuale</b>" : ""}
          ${r.restoredFrom ? "<br><span>ripristinata</span>" : ""}</div>
          <div class="row-btns">${i === 0 ? "" : `<button class="btn" data-restore="${r.revisionId}">Ripristina</button>`}
            <button class="btn" data-export="${r.revisionId}">Esporta</button></div></div>`).join("")}</div>`,
    actions: [{ label: "Chiudi", value: null }],
    onOpen(box, close) {
      box.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = () => close({ restore: b.dataset.restore })));
      box.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => exportRevision(ctx, p, b.dataset.export)));
    },
  });
  if (choice?.restore) {
    await lib.restore(id, choice.restore);
    await notice("Revisione ripristinata", `<p>È ora la revisione attuale di <b>${esc(p.name)}</b>.</p>`);
    ctx.go("programs");
  }
}

async function exportRevision(ctx, p, revisionId) {
  const r = p.revisions.find((x) => x.revisionId === revisionId);
  const bytes = await ctx.lib.originalFile(revisionId);
  if (!bytes) return notice("File non disponibile", "<p>Il file originale di questa revisione non è stato trovato.</p>");
  await shareFile(r.fileName, bytes);
}

/** "Scarica template…": an empty program file in either format, with instructions and a one-week example. */
async function downloadTemplate() {
  const format = await dialog({
    title: "Scarica template",
    body: `<p>Un file .xlsx già impostato, con un esempio di una settimana in giallo e le istruzioni nel foglio <b>note</b>.
      Compilalo in Excel o Numbers e importalo.</p>
      <ul class="summary"><li><b>PL28</b>: accessori uguali per tutto il blocco, l'app toglie 1 serie nelle settimane leggere.</li>
      <li><b>Coach</b>: ogni sessione scritta per intero, gli accessori possono cambiare ogni settimana.</li></ul>`,
    actions: [
      { label: FORMAT_LABEL.pl28, value: "pl28", kind: "primary" },
      { label: FORMAT_LABEL.coach, value: "coach" },
      { label: "Annulla", value: null },
    ],
  });
  if (!format) return;
  await shareFile(TEMPLATE_NAMES[format], await writeXlsx(templateWorkbook(format)));
}

/** "Esporta come xlsx…": the program as a file to edit, then bring back with "Aggiorna da xlsx…". */
async function exportAsXlsx(p) {
  const model = currentRevision(p).model;
  const formats = exportFormats(model);
  const no = formats.find((f) => !f.ok);
  const format = await dialog({
    title: `Esporta ${p.name}`,
    body: `<p>Modifica il file in Excel o Numbers, poi riportalo con <b>Aggiorna da xlsx…</b>: vedrai cosa cambia prima di confermare.</p>
      <p class="muted">Nel foglio Massimali ci sono i massimali del file; quelli modificati nell'app restano nell'app.</p>
      ${no ? `<p class="muted">${esc(no.reason)}</p>` : ""}`,
    actions: [
      ...formats.filter((f) => f.ok).map((f, i) => ({ label: FORMAT_LABEL[f.format], value: f.format, kind: f.format === model.format || i === 0 ? "primary" : undefined })),
      { label: "Annulla", value: null },
    ],
  });
  if (!format) return;
  await shareFile(`${p.name}.xlsx`, await writeXlsx(exportProgram(model, format)));
}

/** "Verifica file…": runs the parser and shows the errors, or OK and what it found. Saves nothing. */
async function verifyFile() {
  const file = await pickFile();
  if (!file) return;
  const r = parseXlsx(file.bytes);
  if (!r.ok) return showImportErrors(file.name, r, { verify: true });
  const m = r.model;
  await notice("File valido", `
    <p><b>${esc(file.name)}</b> rispetta il formato ${m.format === "coach" ? "coach" : "PL28"} e si può importare. Non è stato salvato niente.</p>
    <ul class="summary"><li>${m.weeks.length} settimane, ${m.blocks.length} blocchi</li><li>Giorni: ${esc(m.days.join(", "))}</li>
      <li>${m.lifts.length ? `Massimali: ${esc(m.lifts.map((l) => l.name).join(", "))}` : "Senza massimali: carichi fissi"}</li></ul>
    ${r.warnings.length ? `<p>Avvisi:</p><pre class="errlist">${esc(r.warnings.map(formatIssue).join("\n"))}</pre>` : ""}`);
}

async function writeXlsx(description) {
  const { writeWorkbook } = await import("../xlsx-write.js");
  return writeWorkbook(description);
}

/** Rename, duplicate, export, priority groups, delete. */
async function showMore(ctx, id) {
  const { lib } = ctx;
  const p = lib.get(id);
  const choice = await dialog({
    title: p.name,
    actions: [
      { label: "Esporta come xlsx…", value: "xlsx", kind: "primary" },
      { label: "Rinomina", value: "rename" },
      { label: "Duplica", value: "duplicate" },
      { label: "Esporta file originale", value: "export" },
      { label: "Gruppi prioritari…", value: "groups" },
      { label: "Elimina", value: "delete", kind: "danger" },
      { label: "Annulla", value: null },
    ],
  });
  if (choice === "xlsx") {
    await exportAsXlsx(p);
  } else if (choice === "rename") {
    const r = await dialog({
      title: "Rinomina",
      body: `<input type="text" value="${esc(p.name)}" aria-label="Nome del programma">`,
      actions: [{ label: "Salva", value: true, kind: "primary" }, { label: "Annulla", value: false }],
      onOpen: (box) => box.querySelector("input").select(),
      collect: (box) => box.querySelector("input").value,
    });
    if (r.value) await lib.rename(id, r.data);
  } else if (choice === "duplicate") {
    await lib.duplicate(id);
  } else if (choice === "export") {
    await exportRevision(ctx, p, currentRevision(p).revisionId);
  } else if (choice === "groups") {
    await editPriorityGroups(ctx, p);
  } else if (choice === "delete") {
    const sure = await dialog({
      title: `Eliminare ${p.name}?`,
      body: `<p>Vengono cancellate tutte le ${p.revisions.length} revisioni, i file originali e i massimali modificati. Non si può annullare.</p>`,
      actions: [{ label: "Elimina", value: true, kind: "danger" }, { label: "Annulla", value: false }],
    });
    if (sure) await lib.remove(id);
  }
  ctx.go("programs");
}

/** Which accessory groups get the accent color in the session view. */
async function editPriorityGroups(ctx, p) {
  const model = currentRevision(p).model;
  const groups = [...new Set(model.weeks.flatMap((w) => w.days.flatMap((d) => d.items.map((i) => i.group))))]
    .filter((g) => g && g !== "Fondamentale");
  const current = new Set(p.settings?.priorityGroups || []);
  const r = await dialog({
    title: "Gruppi prioritari",
    body: `<p>Evidenziati nella tabella degli accessori.</p>
      ${groups.map((g, i) => `<label class="check"><input type="checkbox" data-g="${i}" ${current.has(g) ? "checked" : ""}> ${esc(g)}</label>`).join("")}`,
    actions: [{ label: "Salva", value: true, kind: "primary" }, { label: "Annulla", value: false }],
    collect: (box) => [...box.querySelectorAll("[data-g]")].filter((c) => c.checked).map((c) => groups[+c.dataset.g]),
  });
  if (r.value) await ctx.lib.setPriorityGroups(p.id, r.data);
}
