// The "Sessione" tab (spec §4 P0.1–5): program name and editable maxes, week and day selectors,
// and the day's session sheet. Called by main.js. The numbers come from resolve.js; this file only draws.
import { session, isLightPhase, maxesFor, sessionOrder, daySubtitle, fmt, platesPerSide, DEFAULT_PLATES } from "../resolve.js";
import { currentRevision } from "../programs.js";
import { esc } from "./dom.js";

// IPF plate colors: A red, B blue, C yellow, D green, E grey, then the palette repeats.
const DAY_COLORS = ["var(--p25)", "var(--p20)", "var(--p15)", "var(--p10)", "var(--dE)"];
// Plate weight → [color, height in px] for the diagram.
const PLATE_LOOK = { 25: ["var(--p25)", 44], 20: ["var(--p20)", 40], 15: ["var(--p15)", 34], 10: ["var(--p10)", 28],
  5: ["var(--p5)", 22], 2.5: ["var(--p25k)", 18], 1.25: ["var(--p125)", 14], 0.5: ["var(--p125)", 10] };
const PHASE_LABEL = { "": "Carico", transizione: "Transizione", entrata: "Entrata", TEST: "Test" };
const PHASE_BANNER = {
  transizione: "Settimana di transizione: accessori già scalati di 1 serie, tieni RIR +1.",
  TEST: "Settimana test: accessori già scalati di 1 serie, tieni RIR +1.",
  entrata: "Settimana di entrata: carichi pesanti, nessun tentativo oltre l’indicato.",
};

export function dayColor(model, day) {
  return DAY_COLORS[model.days.indexOf(day) % DAY_COLORS.length];
}

export function renderSession(el, ctx) {
  const { lib } = ctx;
  const p = lib.active();
  if (!p) return renderEmpty(el, ctx);

  const model = currentRevision(p).model;
  let pos = lib.position(p.id);
  const order = sessionOrder(model);
  const maxes = () => maxesFor(model, lib.editedMaxes(p.id));

  el.innerHTML = `
    <div class="wrap">
      <header class="top">
        <div class="brand">
          <h1>${esc(p.name)}</h1>
          <p>${model.weeks.length} settimane · ${model.days.length} giorni · carichi calcolati dai massimali</p>
        </div>
        <div class="maxes" role="group" aria-label="Massimali">
          ${model.lifts.map((l, i) => `
            <div class="max"><label for="mx${i}">${esc(l.name)}</label>
              <input id="mx${i}" data-lift="${esc(l.id)}" type="text" inputmode="decimal" autocomplete="off"></div>`).join("")}
          <div class="total">Totale <b data-total></b></div>
          <button class="btn link" data-reset>Ripristina dal file</button>
        </div>
      </header>
      <section aria-label="Settimana"><div class="weeks" data-weeks></div></section>
      <section aria-label="Giorno"><div class="days" data-days></div></section>
      <article class="sheet" data-sheet></article>
    </div>`;

  const $ = (s) => el.querySelector(s);

  // ---- maxes: saved as you type, every load recalculates
  const drawMaxes = () => {
    const m = maxes();
    const edited = lib.editedMaxes(p.id);
    el.querySelectorAll("[data-lift]").forEach((inp) => {
      if (document.activeElement !== inp) inp.value = fmt(m[inp.dataset.lift]);
      inp.classList.toggle("edited", inp.dataset.lift in edited);
    });
    $("[data-total]").textContent = fmt(Object.values(m).reduce((a, b) => a + b, 0));
    $("[data-reset]").disabled = !Object.keys(edited).length;
  };
  el.querySelectorAll("[data-lift]").forEach((inp) => {
    inp.addEventListener("input", async () => {
      const v = parseFloat(inp.value.replace(",", "."));
      if (!(v > 0)) return;
      await lib.setMax(p.id, inp.dataset.lift, v);
      drawMaxes();
      drawSheet();
    });
    inp.addEventListener("blur", drawMaxes); // show the saved value again if the field was left invalid
  });
  $("[data-reset]").onclick = async () => {
    await lib.resetMaxes(p.id);
    drawMaxes();
    drawSheet();
  };

  // ---- selectors
  const drawNav = () => {
    $("[data-weeks]").innerHTML = model.blocks.map((b, bi) => {
      const weeks = model.weeks.filter((w) => w.block === bi);
      const btns = weeks.map((w) => {
        const light = isLightPhase(w.phase);
        const tip = `Settimana ${w.number}${w.phase ? ` · ${w.phase}` : ""}`;
        return `<button class="wk${light ? " light" : ""}" data-w="${w.number}" aria-pressed="${w.number === pos.week}" title="${esc(tip)}" aria-label="${esc(tip)}">${w.number}</button>`;
      }).join("");
      return `<div class="blk"><div class="label">${esc(b.name)}</div><div class="row" style="--n:${weeks.length}">${btns}</div></div>`;
    }).join("");
    $("[data-days]").innerHTML = model.days.map((d) =>
      `<button class="day" style="--dc:${dayColor(model, d)}" data-d="${d}" aria-pressed="${d === pos.day}"><b>${d}</b><span>${esc(daySubtitle(model, d))}</span></button>`).join("");
  };
  $("[data-weeks]").addEventListener("click", (e) => { const t = e.target.closest("[data-w]"); if (t) go(+t.dataset.w, pos.day); });
  $("[data-days]").addEventListener("click", (e) => { const t = e.target.closest("[data-d]"); if (t) go(pos.week, t.dataset.d); });

  // ---- the session sheet
  const drawSheet = () => {
    const s = session(model, pos.week, pos.day, maxes());
    const prio = new Set(p.settings?.priorityGroups || []);
    const i = order.findIndex((o) => o.week === pos.week && o.day === pos.day);
    const phaseLabel = PHASE_LABEL[s.phase] ?? s.phase;

    let banner = PHASE_BANNER[s.phase] ? `<div class="banner">${PHASE_BANNER[s.phase]}</div>` : "";
    if (s.accessoryOnly) banner += `<div class="banner">${esc(accessoryDayReminder(model, s.day))}</div>`;

    const lifts = s.mains.map((m) => `
      <div class="lift">
        <div><div class="nm">${esc(m.name)}</div>${m.variant ? `<div class="var">${esc(m.variant)}</div>` : ""}</div>
        <div class="rx">${esc(m.text)}</div>
        <div>${m.plates && m.kg ? platesHtml(m.kg) : ""}</div>
      </div>`).join("");

    const accRows = s.accessories.map((a) => `
      <tr><td class="ex">${esc(a.name)}${a.instructions ? `<small>${esc(a.instructions)}</small>` : ""}</td>
      <td class="sr">${a.setsThisWeek}×${esc(a.reps)}</td><td class="it">${esc(a.intensity)}</td>
      <td>${a.group ? `<span class="tag${prio.has(a.group) ? " pri" : ""}">${esc(a.group)}</span>` : ""}</td></tr>`).join("");

    const sheet = $("[data-sheet]");
    sheet.style.setProperty("--dc", dayColor(model, s.day));
    sheet.innerHTML = `
      <div class="sheet-head">
        <div style="display:grid;gap:6px">
          <h2>Settimana ${s.week} · <i>Giorno ${s.day}</i></h2>
          <div class="meta">
            <span class="pill">${esc(s.blockName)}</span>
            <span class="pill${s.phase ? " warn" : ""}">${esc(phaseLabel)}</span>
            <span class="pill">${s.mains.length} fondamentali · ${s.accessories.length} accessori</span>
          </div>
        </div>
        <div class="nav">
          <button data-step="-1" ${i === 0 ? "disabled" : ""}>← Prec.</button>
          <button data-step="1" ${i === order.length - 1 ? "disabled" : ""}>Succ. →</button>
        </div>
      </div>
      ${banner}
      ${s.mains.length
        ? `<div class="sec"><h3>Fondamentali</h3></div><div>${lifts}</div>`
        : `<div class="empty">Nessun fondamentale: sessione di soli accessori.</div>`}
      ${s.accessories.length ? `
        <div class="sec"><h3>Accessori</h3></div>
        <div class="tbl"><table><thead><tr><th>Esercizio</th><th>Serie×rep</th><th>Intensità</th><th>Gruppo</th></tr></thead>
        <tbody>${accRows}</tbody></table></div>` : ""}`;
  };
  $("[data-sheet]").addEventListener("click", (e) => { const b = e.target.closest("[data-step]"); if (b) step(+b.dataset.step); });

  // ---- moving around
  function go(week, day) {
    pos = { week, day };
    lib.setPosition(p.id, pos);
    drawNav();
    drawSheet();
  }
  function step(dir) {
    const i = order.findIndex((o) => o.week === pos.week && o.day === pos.day) + dir;
    if (i >= 0 && i < order.length) go(order[i].week, order[i].day);
  }
  // Swipe left/right on the sheet = next/previous. Only clearly horizontal swipes, so scrolling still works.
  let start = null;
  const sheetEl = $("[data-sheet]");
  sheetEl.addEventListener("touchstart", (e) => { const t = e.touches[0]; start = { x: t.clientX, y: t.clientY }; }, { passive: true });
  sheetEl.addEventListener("touchend", (e) => {
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  ctx.onKey = (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  };

  drawMaxes();
  drawNav();
  drawSheet();
}

function platesHtml(kg) {
  const r = platesPerSide(kg, DEFAULT_PLATES);
  if (!r) return "";
  const plates = r.plates.map((w) => {
    const [c, h] = PLATE_LOOK[w] || ["var(--p125)", 12];
    return `<div class="plate" style="height:${h}px;background:${c}" title="${fmt(w)} kg"></div>`;
  }).join("");
  const cap = r.plates.map(fmt).join("+") || "vuoto";
  return `<div class="plates" aria-label="Dischi per lato a ${fmt(kg)} kg"><div class="bar"></div>${plates}
    <span class="pl-cap">${fmt(kg)}: ${cap}${r.rest ? ` (manca ${fmt(r.rest)})` : ""}</span></div>`;
}

/**
 * PL28's rule "never E the day before B or D": B and D are the deadlift days. For any program, the
 * reminder names the days with a slot starting with "Stacco"; with none, it stays generic.
 */
function accessoryDayReminder(model, day) {
  const heavy = model.days.filter((d) => model.slots.some((s) => s.day === d && s.name.startsWith("Stacco")));
  if (!heavy.length) return `Fai ${day} solo se domani non c’è una sessione pesante.`;
  const list = heavy.length === 1 ? heavy[0] : `${heavy.slice(0, -1).join(", ")} o ${heavy[heavy.length - 1]}`;
  return `Fai ${day} solo se domani non c’è ${list}.`;
}

function renderEmpty(el, ctx) {
  el.innerHTML = `
    <div class="wrap">
      <div class="card empty-state">
        <h2>Nessun programma</h2>
        <p class="muted">Importa un file .xlsx nel formato PL (come PL28.xlsx). I carichi vengono calcolati dai massimali del file, che puoi modificare nell’app.</p>
        <button class="btn primary" data-import>Importa programma</button>
      </div>
    </div>`;
  el.querySelector("[data-import]").onclick = () => ctx.importProgram();
}
