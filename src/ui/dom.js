// Small DOM helpers shared by the views: HTML escaping and the in-app dialog.
// The dialog replaces the browser's confirm()/prompt()/alert(), which look foreign inside an app
// and which the spec rules out for delete confirmations.

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Shows a bottom sheet and resolves with the `value` of the button pressed (null if dismissed).
 *   title:   heading
 *   body:    HTML (already escaped by the caller)
 *   actions: [{label, value, kind: "primary" | "danger" | undefined}]
 *   onOpen:  called with the dialog element, e.g. to focus an input or wire extra buttons
 *   collect: called with the dialog element when a button is pressed; its result is returned as {value, data}
 */
export function dialog({ title, body = "", actions = [{ label: "OK", value: true, kind: "primary" }], onOpen, collect }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <div class="body">${body}</div>
        <div class="actions">${actions.map((a, i) => `<button class="btn ${a.kind || ""}" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>
      </div>`;
    const box = overlay.firstElementChild;
    const close = (result) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === "Escape") close(collect ? { value: null } : null); };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) return close(collect ? { value: null } : null);
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const value = actions[+b.dataset.i].value;
      close(collect ? { value, data: collect(box) } : value);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    onOpen?.(box, close);
  });
}

/** Short notice with a single OK. */
export function notice(title, bodyHtml) {
  return dialog({ title, body: bodyHtml, actions: [{ label: "OK", value: true, kind: "primary" }] });
}

/** dd/mm/yyyy, Italian style. */
export function date(iso) {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}
