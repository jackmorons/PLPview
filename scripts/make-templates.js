// Writes the two templates to examples/ (PL-template-PL28.xlsx, PL-template-coach.xlsx), to send to people.
// The app builds the same files on demand ("Scarica template"); both come from src/templates.js.
// Run with `npm run templates`. tests/export.test.js checks that both import cleanly.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { templateWorkbook, TEMPLATE_NAMES } from "../src/templates.js";
import { writeWorkbook } from "../src/xlsx-write.js";

mkdirSync(fileURLToPath(new URL("../examples/", import.meta.url)), { recursive: true });
for (const [format, name] of Object.entries(TEMPLATE_NAMES)) {
  const out = fileURLToPath(new URL(`../examples/${name}`, import.meta.url));
  writeFileSync(out, await writeWorkbook(templateWorkbook(format)));
  console.log("Scritto", out);
}
