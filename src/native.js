// The ONLY place (with storage.js) that talks to Capacitor plugins. Everything else in src/ is plain JS.
// In a desktop browser (`npm run dev`) each function falls back to a web equivalent.
// Called by the UI (ui/programs.js, ui/errors.js). The device branches are exercised in milestone 4.
import { Capacitor } from "@capacitor/core";
import { FilePicker } from "@capawesome/capacitor-file-picker";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { fromBase64, toBase64 } from "./storage.js";

const native = Capacitor.isNativePlatform();
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** "ios", "android" or "web". */
export function platform() {
  return Capacitor.getPlatform();
}

/** Lets the user pick one .xlsx. Returns {name, bytes: Uint8Array}, or null if cancelled. */
export async function pickFile() {
  if (native) {
    try {
      const r = await FilePicker.pickFiles({ types: [XLSX_MIME], limit: 1, readData: true });
      const f = r.files[0];
      return f ? { name: f.name, bytes: fromBase64(f.data) } : null;
    } catch {
      return null; // the plugin rejects when the user cancels
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx," + XLSX_MIME;
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Hands a file to the share sheet (phone) or downloads it (browser). */
export async function shareFile(name, bytes, mime = XLSX_MIME) {
  if (native) {
    const { uri } = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: toBase64(bytes) });
    await Share.share({ title: name, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text to the clipboard. Returns false if the platform refused. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
