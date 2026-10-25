// The ONE place the app saves and loads data. Called by library.js only.
// On a phone: JSON and binary files in the app's private data folder (Capacitor Filesystem, Directory.Data),
// which the system doesn't wipe the way it can wipe web storage. In a desktop browser (`npm run dev`):
// localStorage, under keys starting with "pl/".
//
// Keys are paths: "state.json", "programs/<id>.json", "maxes/<id>.json", "files/<revisionId>.xlsx".
// The device branch is exercised on phones in milestone 4.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

const native = Capacitor.isNativePlatform();
const PREFIX = "pl/";

export async function readJSON(key) {
  try {
    if (native) {
      const r = await Filesystem.readFile({ path: key, directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(r.data);
    }
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? null : JSON.parse(v);
  } catch {
    return null; // missing or unreadable: callers treat it as "not saved yet"
  }
}

export async function writeJSON(key, value) {
  const data = JSON.stringify(value);
  if (native) {
    await Filesystem.writeFile({ path: key, directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true });
  } else {
    localStorage.setItem(PREFIX + key, data);
  }
}

export async function writeBytes(key, bytes) {
  const data = toBase64(bytes);
  if (native) await Filesystem.writeFile({ path: key, directory: Directory.Data, data, recursive: true });
  else localStorage.setItem(PREFIX + key, data);
}

export async function readBytes(key) {
  try {
    const data = native
      ? (await Filesystem.readFile({ path: key, directory: Directory.Data })).data
      : localStorage.getItem(PREFIX + key);
    return data == null ? null : fromBase64(data);
  } catch {
    return null;
  }
}

export async function remove(key) {
  try {
    if (native) await Filesystem.deleteFile({ path: key, directory: Directory.Data });
    else localStorage.removeItem(PREFIX + key);
  } catch {
    // already gone
  }
}

/** File names under a folder, e.g. list("programs") → ["3f2a….json", …]. */
export async function list(folder) {
  if (native) {
    try {
      const r = await Filesystem.readdir({ path: folder, directory: Directory.Data });
      return r.files.map((f) => f.name);
    } catch {
      return [];
    }
  }
  const start = `${PREFIX}${folder}/`;
  return Object.keys(localStorage).filter((k) => k.startsWith(start)).map((k) => k.slice(start.length));
}

export function toBase64(bytes) {
  let s = "";
  // Chunked: String.fromCharCode(...bigArray) overflows the call stack on files of a few hundred KB.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
