# PL app (PLPview)

Start with `docs/HANDOFF.md`: current state, decisions already made, open issues, next step.
Then `VERSIONS.md` for the dated decisions and changelog, and `docs/PL-App-SPEC.md` for the full brief.

- Plain JS + Vite + Capacitor 8. Only `src/storage.js` and `src/native.js` may import Capacitor; everything else stays pure and testable in Node.
- UI and program text are Italian. Never change program strings or Jack's notation.
- `npm test` must pass before every commit. Keep `docs/FORMAT.md` / `docs/FORMAT-COACH.md` in sync with the parsers.
- Ask Jack before changing the RPE chart, plate/bar defaults, the light-week rule or any format spec.
- Update `VERSIONS.md` at every milestone and every change of plan.
