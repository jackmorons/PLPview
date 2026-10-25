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
| `src/parser.js` | xlsx bytes → program model, or the list of errors | no (pure) |
| `src/model.js` | the model's rules: `validateProgram()`, `migrate()` | no (pure) |
| `src/resolve.js` | model + maxes → strings, accessory sets, plates | no (pure) |
| `src/tools.js` | RPE, back-off, rep counter (milestone 5) | no (pure) |
| `src/storage.js` | save/load JSON: phone files on device, localStorage in the browser (milestone 4) | **yes** |
| `src/native.js` | file picker, haptics, keep-awake, share sheet (milestone 4) | **yes** |
| `src/ui/*` | draws the screens (milestone 3) | no |
| `src/main.js` | starts the app, switches tabs | no |

"Pure" means: input in, output out, no screen, no phone. That's why `npm test` can check them on any
computer in a couple of seconds.

## One action, end to end: importing PL28

Steps marked *(milestone n)* don't exist yet; this section grows as they're built.

1. You tap **Importa programma**. *(milestone 3, `ui/programs.js`)*
2. `native.js → pickFile()` opens the phone's file picker, limited to .xlsx, and returns the file's bytes. *(milestone 4)*
3. The bytes go to `parser.js → parseXlsx(bytes)`:
   - SheetJS reads the workbook, keeping each cell's formula (`cell.f`) and Excel's cached value (`cell.v`).
   - `parseMassimali()` finds the lifts and remembers which row each one is on.
   - `parseOverall()` reads blocks and weeks. Each formula goes through `parseFormula()`, which accepts only
     the grammar in `FORMAT.md` and turns `MROUND(Massimali!$B$3*0.57,2.5)` into a token
     `{lift: "squat", pct: 0.57, step: 2.5}`.
   - `parseAccessori()` reads the accessories and their sets per block.
   - `model.js → validateProgram()` checks the rules that don't depend on xlsx (weeks consecutive, etc.).
   - Result: `{ok: true, model}` or `{ok: false, errors: [{ref: "overall!D7", msg: "…"}]}`.
4. If it failed, the errors screen lists every problem. Nothing is saved. *(milestone 3)*
5. If it worked, `storage.js` saves the model as `programs/<id>.json`, with a new random id. *(milestone 4)*
6. `ui/session.js` draws week 1 day A. For each prescription it calls `resolve.js → renderRx(rx, maxes)`:
   text parts as written, each load token as `MROUND(max × pct, step)`, so editing a max recalculates every
   load immediately. *(milestone 3)*

## Tests

`npm test` runs Vitest on the pure files:
- `tests/golden.test.js`: PL28.xlsx must give, for every week × column, the same string as the approved
  prototype (`fixtures/PL28_standalone.html`), and the same value Excel cached in the file.
- `tests/parser.test.js`: PL28's structure, the formula grammar, and every rejection case from the spec.
- `tests/resolve.test.js`: plates, rounding, session order, model rules.

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
