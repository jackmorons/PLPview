// The ONLY place (with storage.js) that talks to Capacitor plugins. Everything else in src/ is plain JS.
// In a desktop browser (`npm run dev`) each function falls back to a web equivalent or does nothing.
// Milestone 1 only needs platform(); pickFile, haptic, keepAwake and share are added in milestone 4.
import { Capacitor } from "@capacitor/core";

/** "ios", "android" or "web". */
export function platform() {
  return Capacitor.getPlatform();
}
