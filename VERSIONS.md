# PL App: versions

Roadmap and changelog for the PL app. **Keep this file up to date**:
- when starting a version: set its status, note the branch or tag
- when finishing a version: tick the acceptance boxes, add a changelog entry, tag the release
- whenever a decision changes the plan: add it to the version's "Decisions" list with the date

Status values: `planned` → `specified` → `in progress` → `released` (or `dropped`).

| Version | Goal | Status | Spec | Released |
|---|---|---|---|---|
| v1 | Import a strict-format xlsx and view it; edit maxes; training tools | in progress (milestones 1–3 done) | `PL-App-SPEC.md` | — |
| v2 | The app includes the xlsx template, to download, edit and import; programs can be exported back to xlsx | planned | this file, §v2 | — |
| v3 | Create and edit programs directly in the app | planned | this file, §v3 | — |

---

## Foundations that every version depends on (start in v1)

These are part of v1 even though their payoff comes later. Don't skip them.

1. **The program model is the contract, not the xlsx.**
   - `docs/PROGRAM-SCHEMA.md` defines the internal JSON program (lifts and default maxes, blocks, weeks + phases, slots, prescriptions as templates with load tokens, accessories, notes). It has a `schemaVersion` field, starting at `1`.
   - The xlsx parser is just one *adapter* that turns xlsx into the model. v2 adds the reverse adapter (model to xlsx). v3 adds an editor that works on the model directly.
2. **Validation lives on the model.**
   - `validateProgram(model)` contains every rule that doesn't depend on the file format (consecutive weeks, set columns matching the number of blocks, load tokens pointing at existing lifts, etc.). The parser and the v3 editor both call it, so the same rules apply everywhere.
   - The parser keeps only xlsx-specific checks (headers, formula grammar, cell references).
3. **Migrations.**
   - Saved programs carry their `schemaVersion`. On launch, `migrate(model)` upgrades older ones step by step.
   - Never break a program Jack has already saved.
4. **Format version in the xlsx.**
   - v1 treats a file without a `meta` sheet as format v1.
   - From v2, the template carries a `meta` sheet: `A1 = formatVersion`, `B1 = <n>`.
   - The parser picks the matching rules and rejects any newer format version it doesn't know, with a clear message.

---

## v1: import and view

**Spec:** `PL-App-SPEC.md` (Capacitor, iOS + Android).

**Scope:** strict xlsx import (format v1, as in `PL28.xlsx`), session viewer, editable and saved maxes, P1 tools (back-off, RPE, rep-total counter, plates, ramping), P2 (EMOM and rest timers, volume view, JSON backup).

**Additions to the spec from this roadmap:**
- [x] `docs/PROGRAM-SCHEMA.md` + `schemaVersion: 1` on every saved program (schema written; saving arrives in milestone 4)
- [x] `validateProgram()` kept separate from the xlsx parser (`src/model.js`)
- [x] `migrate()` in place, even if it does nothing in v1
- [x] Multiple programs with one active; "Aggiorna da xlsx" with a change summary; revision history (last 5) with restore; program id is a UUID, not a file hash

**Acceptance:** §7 of the spec, all on both platforms.
- [x] §7.1 golden test (automated: 200/200 cells match the prototype, 97/97 match Excel's cached values)
- [x] §7.2 maxes recalculate (automated)
- [x] §7.3 accessories (automated)
- [x] §7.4 days (automated)
- [x] §7.5 rejections (automated: PL27, broken header, non-integer week, missing Massimali row, `=B3*2`)
- [x] §7.6 persistence, §7.7 programs and revisions (automated against an in-memory store; browser run checked with Playwright) · [ ] on phones (milestone 4)
- [ ] §7.8 offline on phones (milestone 4; in the browser: no external requests, fonts bundled)
- [ ] Manual checklist (`docs/CHECKLIST.md`) on iPhone and Android

**Milestones:** 1 scaffold ✅ (awaiting Jack's phone checkpoint) · 2 parser + golden test ✅ · 3 P0 UI in browser ✅ (awaiting Jack's checkpoint) · 4 P0 on phones · 5 P1 tools, then P2

**Decisions**
- 2026-10-25: Capacitor, one codebase, built with Xcode and Android Studio.
- 2026-10-25: No session logging; Jack uses an external logger.
- 2026-10-25: The app holds several programs and Jack picks the active one. Updating a program from a new xlsx keeps its identity, maxes and position; old revisions are kept and can be restored.
- 2026-10-25: Bundle id `it.jackmorons.plpviewapp` (both platforms). App name stays "PL".
- 2026-10-25: **Format change (approved by Jack):** text load placeholders use the full lift name, `{Squat .57}`, not a first letter. The spec's letter rule could not work for PL28: Squat and Stacco share "S".
- 2026-10-25: Capacitor 8.5.3 (current stable), iOS via Swift Package Manager (no CocoaPods). Minimums: iOS 15, Android 7 (API 24); target API 36; JDK 21.
- 2026-10-25: SheetJS pinned at 0.18.5, the last version published on npm. It has two known advisories (prototype pollution, ReDoS) triggered by malicious files; the app only opens Jack's own files, so the risk is low. Fixed versions (0.20.x) are only on cdn.sheetjs.com, which this build environment can't reach. **To do:** switch `package.json` to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` from a normal network and re-run the tests.
- 2026-10-25: A completely empty row ends `overall` (the spec didn't say); documented in FORMAT.md.
- 2026-10-25: Light-week buttons (dashed, amber) = phase `transizione` or `TEST`, the same rule as the accessory sets. The prototype didn't style week 20.
- 2026-10-25: Phase banners are generic (no PL28-specific "giorno D ~92%"). The accessory-only-day reminder names the days that have a slot starting with "Stacco" (PL28: "Fai E solo se domani non c’è B o D"), or says "una sessione pesante" if there are none.
- 2026-10-25: Maxes are typed in a text field with a decimal keypad (accepts `112,5` and `112.5`): iOS number fields reject the comma.
- 2026-10-25: On phones the accessories are stacked rows instead of a 4-column table, which didn't fit at 390 px.
- 2026-10-25: Week buttons on a phone are 44 px tall but about 38 px wide (two blocks side by side, as in the prototype). One block per row would meet 44 × 44 but doubles the selector's height.
- 2026-10-25: Day subtitles are built from slot names ("Squat stress · Panca var. · Trazioni"), per the spec, instead of the prototype's hand-written ones.

---

## v2: template in the app + export to xlsx

**Goal:** Jack never has to rebuild the layout by hand. The app hands him a correct template, and any program can go back out to xlsx for editing on a PC.

**Scope**
1. **Template included in the app.**
   - `assets/PL-template.xlsx`, **generated by a script** (`scripts/make-template.js`) rather than edited by hand, so it always matches the parser.
   - Use a library that can write data validation and styles (e.g. ExcelJS). SheetJS community edition can't.
2. **What the template contains:**
   - `meta` sheet (`formatVersion`)
   - `note` sheet with filling instructions and the notation
   - `Massimali`, `overall` and `accessori` with headers, one example block, one example week and example accessory rows (clearly marked as examples)
   - dropdowns: `Giorno` letters; `fase` = empty / `transizione` / `entrata` / `TEST`
   - a header comment on prescription cells showing the formula grammar, e.g. `="4x5 "&MROUND(Massimali!$B$3*0.57,2.5)&"kg"`
   - yellow fill on the cells that are meant to be edited
3. **Download from the app.**
   - "Scarica template" in the Programs tab: write to the app's cache, then open the share sheet (Files, AirDrop, Drive, email).
4. **Export a program as xlsx.**
   - "Esporta come xlsx" for any saved program: model → xlsx in the same format, with real `MROUND` formulas referencing `Massimali`.
   - Programs exported this way can be edited in Excel and re-imported.
5. **Check without importing.** "Verifica file" runs the parser and shows the errors or "OK" without saving anything.

**Out of scope:** editing programs in the app.

**Acceptance**
- [ ] The template from the app imports with no errors (the examples form a valid 1-block program)
- [ ] Round trip: import `PL28.xlsx` → export → import the exported file → the model is identical, apart from ids and dates
- [ ] An exported file opens in Excel, Numbers and Google Sheets with formulas working, and loads recalculate when a max is changed in the sheet
- [ ] A file with a `formatVersion` newer than the app supports is rejected with a clear message
- [ ] Download and share work on iOS and Android

**Decisions**
- _(add here)_

---

## v3: create programs in the app

**Goal:** build or edit a full program on the phone, with the same rules as the xlsx, with no PC required.

**Scope**
1. **New program wizard:** name → lifts + maxes → number of blocks and weeks per block → days (letters + short labels) → main-lift slots (name, day, which lift sets its loads).
2. **Block / week editor:**
   - Grid of weeks × slots. Tap a cell to edit its prescription in a sheet.
   - **"Insert load" button:** pick lift + % → inserts a load token that shows the live kg. No typing formulas.
   - Phase picker per week. Variant per block per slot.
3. **Accessories editor:** per day, with fields matching the `accessori` columns, sets per block as steppers, and group picked from a list (custom groups allowed).
4. **Shortcuts for the work that repeats:**
   - copy a week or block
   - fill down with a step (e.g. +2.5 % per week)
   - copy a slot to another day
   - turn a week into a lighter week (accessories −1 set)
5. **Live feedback while editing:** the volume view (sets per group per block) and `validateProgram()` errors, shown inline on the cell they concern.
6. **Program management:** duplicate as a new version (e.g. PL28 → PL29 draft), undo/redo within a session, delete with confirmation.
7. **Export:** any program made in the app exports to xlsx through v2's exporter, so building in the app and editing on a PC work together.

**Design constraints**
- Editing grids on a phone is slow. Design for one cell at a time: open a cell to edit it, with big tap targets and quick next/previous cell.
- Make sure editing is usable in landscape and on tablets. The desktop browser (`npm run dev`) build can also be the comfortable editor.
- The editor never writes xlsx directly; it only changes the model. Saving runs `validateProgram()`. A draft with errors can be saved but is marked **bozza** (draft) and can't be set as the active program.

**Out of scope:** sharing programs between users, cloud sync, AI-generated programs.

**Acceptance**
- [ ] PL28 can be rebuilt from scratch in the app, and its export matches `PL28.xlsx` row for row (golden test)
- [ ] Editing an imported program and exporting it keeps everything that wasn't edited
- [ ] Validation errors match the parser's on the same mistakes
- [ ] Undo/redo covers every editor action
- [ ] Works on a phone in portrait for small edits, and is comfortable in landscape or on a tablet for full builds

**Decisions**
- _(add here)_

---

## Ideas for later (not planned)

- Export a session to Jack's external logger (CSV or share-text format), once he names the app
- Summary of how planned volume and intensity change over a program (chart)
- Widget or lock-screen view of today's session
- Format v2 features in the xlsx: superset grouping, per-exercise rest times

---

## Changelog

Newest first. One entry per release or significant milestone.

### Unreleased
- 2026-10-25: **Milestone 3.** P0 viewer in the browser: Sessione (maxes saved as you type, "Ripristina dal file", week/day selectors, session sheet with banners, plates, priority groups, prev/next, swipe, arrow keys), Note, Programmi (import, già importato, Aggiorna / Importa come nuovo, change summary, revisions with restore and export, rename, duplicate, priority groups, delete with in-app confirmation), import errors screen (copyable), light/dark theme, bundled fonts. New: `src/programs.js`, `src/library.js`, `src/storage.js`, `src/ui/*`. 46 tests.
- 2026-10-25: **Milestone 2.** `src/parser.js` (xlsx → model, strict, Italian errors with cell refs), `src/model.js` (`validateProgram`, `migrate`), `src/resolve.js` (loads, plates, session view data). 36 Vitest tests including the golden test against the prototype. `docs/FORMAT.md`, `docs/PROGRAM-SCHEMA.md`.
- 2026-10-25: **Milestone 1.** Vite + Capacitor 8 scaffold, `ios/` and `android/` shells, all plugins installed and pinned, "hello" screen. Docs: HOW-IT-WORKS, BUILD-IOS, BUILD-ANDROID, CHECKLIST, README edit loop.
- 2026-10-25: Roadmap created. v1 specified in `PL-App-SPEC.md`; v2 and v3 planned.

<!-- Template:
### vX.Y.Z — YYYY-MM-DD
- Added: …
- Changed: …
- Fixed: …
- Notes: …
-->
