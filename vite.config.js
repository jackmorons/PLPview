// Vite configuration. `npm run dev` serves the app in a desktop browser;
// `npm run build` bundles it into dist/, which `npx cap sync` copies into ios/ and android/.
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the native web view loads index.html from the app bundle, not from a web server root.
  base: "./",
  // ExcelJS is ~930 KB in its own chunk, loaded only when exporting (ui/programs.js): don't warn about it.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  test: { environment: "node", include: ["tests/**/*.test.js"] },
});
