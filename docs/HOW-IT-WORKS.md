# How the PL app works

## The mental model

```
src/  (YOUR app: HTML/CSS/JS)      ← you only ever edit this
   │  npm run build   (Vite bundles it into dist/)
   ▼
dist/                              ← generated, never edit
   │  npx cap sync    (copies dist/ + plugin code into both shells)
   ├──────────────►  ios/      → open in Xcode          → ▶ Run on iPhone
   └──────────────►  android/  → open in Android Studio → ▶ Run on Android
```

- The app is a web page. On the phone it runs inside the system **web view** (Safari's engine on iPhone,
  Chrome's on Android), wrapped in a small native app.
- Capacitor adds a **bridge** so the JavaScript can call phone features (files, haptics, share sheet)
  through **plugins**.
- `ios/` and `android/` are real native projects, generated once by `npx cap add` and committed.
  You only touch them for platform settings (permissions, which file types the app opens).
- The same `src/` also runs in a desktop browser with `npm run dev`. That's the fast loop: edit, save,
  the page reloads. Use the phones only to check what's phone-specific.

## Who does what

| File | Job | May use Capacitor? |
|---|---|---|
| `src/parser.js` | xlsx bytes → program model, or the list of errors; picks the format | no (pure) |
| `src/parse-pl28.js`, `src/parse-coach.js` | the two formats (`FORMAT.md`, `FORMAT-COACH.md`) | no (pure) |
| `src/parse-common.js` | cell reading, formula grammar, Massimali, shared by both | no (pure) |
| `src/model.js` | the model's rules: `validateProgram()`, `migrate()`, week types, `expandV1()` (PL28 → sessions) | no (pure) |
| `src/resolve.js` | model + maxes → strings, accessory sets, plates | no (pure) |
| `src/tools.js` | RPE, back-off, rep counter (milestone 5) | no (pure) |
| `src/programs.js` | program rules: revisions (last 5), restore, what carries over on update, change summary | no (pure) |
| `src/library.js` | the app's data: programs, active one, edited maxes, last week/day; saves through storage.js | no |
| `src/storage.js` | save/load files: phone storage on device, localStorage in the browser | **yes** |
| `src/native.js` | file picker, share sheet, clipboard (haptics, keep-awake in milestone 5) | **yes** |
| `src/ui/session.js` | Sessione tab: maxes, week/day selectors, the session sheet, swipe | no |
| `src/ui/programs.js` | Programmi tab, plus the import and "Aggiorna da xlsx" flows | no |
| `src/ui/note.js`, `ui/tools.js` | Note tab; Strumenti tab (placeholder until milestone 5) | no |
| `src/ui/errors.js`, `ui/dom.js` | import errors screen; in-app dialogs and HTML escaping | no |
| `src/main.js` | starts the app, loads the saved data, draws the tab bar, switches tabs | no |

"Pure" means: input in, output out, no screen, no phone. That's why `npm test` can check them on any
computer in a couple of seconds.

## One action, end to end: importing PL28

1. You tap **Importa programma** → `ui/programs.js → importProgram()`.
2. `native.js → pickFile()` opens the file picker (on the phone the system picker, limited to .xlsx;
   in the browser an `<input type=file>`) and returns `{name, bytes}`.
3. `library.js → analyze(file)` computes the file's SHA-256. If a stored revision has the same hash,
   the app says **già importato** and offers to open that program. Otherwise it calls
   `parser.js → parseXlsx(bytes)`:
   - SheetJS reads the workbook, keeping each cell's formula (`cell.f`) and Excel's cached value (`cell.v`).
   - `parseWorkbook()` picks the format: an `accessori` sheet means PL28 format (`parse-pl28.js`),
     otherwise a `training log` sheet means coach format (`parse-coach.js`).
   - `parse-common.js → parseMassimali()` finds the lifts and remembers which row each one is on.
   - Every formula goes through `parseFormula()`, which accepts only the grammar in `FORMAT.md` and turns
     `MROUND(Massimali!$B$3*0.57,2.5)` into a token `{lift: "squat", pct: 0.57, step: 2.5}`.
   - PL28 format: `readV1()` reads overall and accessori, then `model.js → expandV1()` writes out every
     session (one accessory set less and RIR +1 in light weeks). Coach format: each log row becomes an item;
     `=overall!D3` cells are followed into `overall`.
   - `model.js → validateProgram()` checks the rules that don't depend on xlsx (weeks consecutive, etc.).
   - Result: `{ok: true, model}` or `{ok: false, errors: [{ref: "overall!D7", msg: "…"}]}`.
4. If it failed, `ui/errors.js → showImportErrors()` lists every problem, copyable. Nothing is saved.
5. If a program with the same name exists, the app asks **Aggiorna PL28** / **Importa come nuovo programma**.
6. `library.js → create()` gives the program a random id and, through `storage.js`, writes
   `programs/<id>.json` (the model inside its first revision) and `files/<revisionId>.xlsx` (the original bytes).
7. `main.js → ctx.go("session")` → `ui/session.js → renderSession()` draws week 1 day A. For each
   prescription `resolve.js → session()` calls `renderRx(rx, maxes)`: text parts as written, each load token
   as `MROUND(max × pct, step)`. Editing a max calls `library.js → setMax()`, which saves `maxes/<id>.json`,
   and redraws the sheet, so every load recalculates as you type.

**Updating** ("Aggiorna da xlsx…") follows the same steps 2–4, then `programs.js → changeSummary()` lists what
changes, and on confirm `library.js → update()` adds a revision (keeping the last 5), keeps your edited maxes
for lifts that still exist (`carryMaxes`) and pulls the last week/day back inside the new length (`clampPosition`).

## Tests

`npm test` runs Vitest on the pure files:
- `tests/golden.test.js`: PL28.xlsx must give, for every week × column, the same string as the approved
  prototype (`fixtures/PL28_standalone.html`), and the same value Excel cached in the file.
- `tests/parser.test.js`: PL28's structure, the formula grammar, and every rejection case from the spec.
- `tests/resolve.test.js`: plates, rounding, session order, model rules.
- `tests/coach.test.js`: the coach format: PL28_coach.xlsx, the same sessions as PL28.xlsx, PL27's errors, week types.
- `tests/example.test.js`: `examples/example.xlsx` imports cleanly.
- `tests/library.test.js`: saving and reloading, several programs, update with change summary, already imported, restore, delete.

## Glossary

- **Web view**: the browser engine embedded in a native app, without the address bar. Our whole UI runs in it.
- **Plugin**: a package with a JS side (what we call) and native Swift/Kotlin sides (what runs on the phone).
- **Bridge**: Capacitor's channel that carries a plugin call from JS to native code and the answer back.
- **`cap sync`**: copies `dist/` into both native projects and registers the installed plugins with them.
  Forget it and the phone runs the old version.
- **Bundle id / application id**: the app's unique name, `it.jackmorons.plpviewapp`. The phone stores the
  app's data under it, so changing it later means a new, empty app.
- **Signing**: a cryptographic signature proving who built the app. Phones refuse to run unsigned apps.
- **Provisioning profile** (iOS): Apple's permission slip tying your signing certificate, the bundle id and
  your devices together. Xcode makes one automatically. With a free Apple ID it lasts 7 days.
- **APK**: the Android app file. A debug APK is signed with a development key Android Studio creates for you.
- **SPM** (Swift Package Manager): how the iOS project downloads Capacitor's native code. It replaced
  CocoaPods as Capacitor's default, so there's nothing extra to install.
