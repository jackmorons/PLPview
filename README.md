# PLPview

Powerlifting program viewer: imports a training program from a strict-format `.xlsx`, shows it week by week
with loads computed from your maxes, and includes training tools. One web codebase, built with
[Capacitor](https://capacitorjs.com) into an iPhone app (Xcode) and an Android app (Android Studio).

- What it should do: [`docs/PL-App-SPEC.md`](docs/PL-App-SPEC.md) · roadmap and changelog: [`VERSIONS.md`](VERSIONS.md)
- How it works, for humans: [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)
- How to write a program file: [`docs/FORMAT.md`](docs/FORMAT.md) · the internal model: [`docs/PROGRAM-SCHEMA.md`](docs/PROGRAM-SCHEMA.md)
- Build: [`docs/BUILD-IOS.md`](docs/BUILD-IOS.md) · [`docs/BUILD-ANDROID.md`](docs/BUILD-ANDROID.md) · phone checklist: [`docs/CHECKLIST.md`](docs/CHECKLIST.md)

## First time

Install **Node.js LTS** (v22.12 or newer) from [nodejs.org](https://nodejs.org) first: it provides the `npm` command.
Open a new terminal after installing, and check with `node -v`.

```sh
npm install
npm test        # parser + golden test against PL28
```

## The edit loop

**iPhone**
1. `npm run dev`: iterate in a desktop browser at the `http://localhost:…` address it prints (opening `index.html` directly shows a blank page)
2. `npm run build && npx cap sync`: when done
3. `npm run ios`, then ▶ Run in Xcode

**Android**
1. `npm run dev`: iterate in a desktop browser
2. `npm run build && npx cap sync`: when done
3. `npm run android`, then ▶ Run in Android Studio

Only edit `src/`. `dist/` is generated; `ios/` and `android/` are only touched for platform settings.
