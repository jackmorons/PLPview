// App bootstrap. Loaded by index.html; for now it only shows the "hello" screen used to check
// that the build reaches the phone (milestone 1). Tab routing arrives with the P0 UI (milestone 3).
import "./styles.css";
import { platform } from "./native.js";

document.getElementById("app").innerHTML = `
  <main class="hello">
    <h1>PL</h1>
    <p>Build di prova funzionante.</p>
    <p class="muted">Piattaforma: <b>${platform()}</b></p>
  </main>`;
