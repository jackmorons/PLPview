// The "Programmi" tab (spec §4 P0.9) and the import / update flows.
// Called by main.js. Data changes go through library.js; files come from native.js.
import { pickFile, shareFile } from "../native.js";
import { currentRevision, isEmptySummary } from "../programs.js";
import { dialog, notice, esc, date } from "./dom.js";
import { showImportErrors, showImportWarnings } from "./errors.js";

export function renderPrograms(el, ctx) {
  const { lib } = ctx;
  const list = lib.programs();
  const activeId = lib.active()?.id;

  el.innerHTML = `
    <div class="wrap">
      <header class="top"><h1 class="page-title">Programmi</h1>
        <button class="btn primary" data-import>Importa programma</button></header>
      ${list.length ? "" : `<div class="card empty-state"><h2>Nessun programma</h2>
        <p class="muted">Importa un file .xlsx nel formato PL per iniziare.</p></div>`}
      ${list.map((p) => {
        const r = currentRevision(p);
        const active = p.id === activeId;
        return `
          <section class="card prog${active ? " active" : ""}">
            <button class="prog-main" data-open="${p.id}" aria-label="${active ? "Programma attivo" : "Rendi attivo"}: ${esc(p.name)}">
              <div><h3>${esc(p.name)}</h3>
                <div class="muted">${r.model.weeks.length} settimane · ${r.model.days.length} giorni</div>
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
  if (s.slotsAdded.length) lines.push(`Fondamentali aggiunti: ${esc(s.slotsAdded.join(", "))}`);
  if (s.slotsRemoved.length) lines.push(`Fondamentali rimossi: ${esc(s.slotsRemoved.join(", "))}`);
  if (s.cellsChanged) lines.push(`Prescrizioni modificate: ${s.cellsChanged}`);
  if (s.accessoriesAdded.length) lines.push(`Accessori aggiunti: ${esc(s.accessoriesAdded.join(", "))}`);
  if (s.accessoriesRemoved.length) lines.push(`Accessori rimossi: ${esc(s.accessoriesRemoved.join(", "))}`);

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

/** Rename, duplicate, export, priority groups, delete. */
async function showMore(ctx, id) {
  const { lib } = ctx;
  const p = lib.get(id);
  const choice = await dialog({
    title: p.name,
    actions: [
      { label: "Rinomina", value: "rename" },
      { label: "Duplica", value: "duplicate" },
      { label: "Esporta file originale", value: "export" },
      { label: "Gruppi prioritari…", value: "groups" },
      { label: "Elimina", value: "delete", kind: "danger" },
      { label: "Annulla", value: null },
    ],
  });
  if (choice === "rename") {
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
  const groups = [...new Set(model.accessories.map((a) => a.group).filter(Boolean))];
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
