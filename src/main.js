// App bootstrap and tab routing. Loaded by index.html.
// Loads the saved programs (library.js over storage.js), draws the bottom tab bar and shows one tab at a time.
// The app opens on the active program at its last week/day, or on the empty state if there's none.
import "./styles.css";
import * as storage from "./storage.js";
import { createLibrary } from "./library.js";
import { renderSession } from "./ui/session.js";
import { renderTools } from "./ui/tools.js";
import { renderNote } from "./ui/note.js";
import { renderPrograms, importProgram } from "./ui/programs.js";
import { notice, esc } from "./ui/dom.js";

const ICONS = {
  session: '<path d="M4 9h2v6H4zM18 9h2v6h-2zM6 7h3v10H6zM15 7h3v10h-3zM9 11h6v2H9z" fill="currentColor"/>',
  tools: '<path d="M5 3h14v18H5zM8 6h8v4H8zM8 13h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2zM8 16h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2z" fill="currentColor" fill-rule="evenodd"/>',
  note: '<path d="M6 3h9l4 4v14H6zM9 10h7v1.5H9zm0 3.5h7V15H9zm0 3.5h5v1.5H9z" fill="currentColor" fill-rule="evenodd"/>',
  programs: '<path d="M4 5h16v3H4zM4 10.5h16v3H4zM4 16h16v3H4z" fill="currentColor"/>',
};
const TABS = [
  ["session", "Sessione", renderSession],
  ["tools", "Strumenti", renderTools],
  ["note", "Note", renderNote],
  ["programs", "Programmi", renderPrograms],
];

const app = document.getElementById("app");
app.innerHTML = `
  <main data-view></main>
  <nav class="tabs" role="tablist">${TABS.map(([id, label]) =>
    `<button role="tab" data-tab="${id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${label}</button>`).join("")}</nav>`;
const view = app.querySelector("[data-view]");

const ctx = {
  lib: createLibrary(storage),
  tab: "session",
  onKey: null,
  go(tab) {
    ctx.tab = tab;
    ctx.onKey = null;
    app.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    TABS.find(([id]) => id === tab)[2](view, ctx);
    window.scrollTo(0, 0);
  },
  importProgram: () => importProgram(ctx),
};

app.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) ctx.go(b.dataset.tab);
});
document.addEventListener("keydown", (e) => ctx.onKey?.(e));

try {
  await ctx.lib.load();
} catch (e) {
  // A saved program the app can't read (e.g. saved by a newer version): say so instead of a blank screen.
  await notice("Errore nel caricamento", `<p>${esc(e.message)}</p>`);
}
ctx.go("session");
