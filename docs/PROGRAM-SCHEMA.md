# Program model, schema version 2

The xlsx is only how a program gets **in**. What the app stores, validates and renders is this JSON model.
Both import formats produce it: the PL28 format (`src/parse-pl28.js`, expanded by `expandV1()` in `src/model.js`)
and the coach format (`src/parse-coach.js`). v2's exporter and v3's editor will read and write it.
The rules on it live in `validateProgram()` in `src/model.js`.

**Every session is explicit**: weeks → days → items. Nothing in the app assumes two weeks look alike.

```jsonc
{
  "schemaVersion": 2,
  "format": "pl28",            // or "coach": which file format it came from

  // Massimali. id = the name in lower case; used by load tokens and by saved maxes. Empty without Massimali.
  "lifts": [ { "id": "squat", "name": "Squat", "defaultMax": 192.5 } ],

  // All day letters, in display order.
  "days": ["A", "B", "C", "D", "E"],

  "weeks": [ {
    "n": 1,
    "type": "normale",         // normale | scarico | transizione | ramping | intensificazione | picco | taper | entrata | test | gara
    "dates": null,             // free text from overall column B (coach format), e.g. "6-12 /10"
    "block": 0,                // index into blocks, or null
    "days": [ {
      "letter": "A",
      "items": [ {
        "kind": "main",                       // "main" or "acc"
        "name": "Squat stress",
        "instructions": "discesa 4''",        // text or null
        "prescription": { "parts": ["4x5 + ist. ", { "lift": "squat", "pct": 0.57, "step": 2.5 }, "kg"] },
        "load": null,                         // template or null (the kg/RPE column)
        "group": "Fondamentale",              // or a muscle group, or null
        "note": null                          // template or null
      } ]
    } ]
  } ],

  // Optional: groups the week picker. Weeks firstWeek..lastWeek, in order, not overlapping.
  "blocks": [ { "name": "Blocco 1 – Accumulo", "firstWeek": 1, "lastWeek": 5 } ],

  "notes": ["PL28 – piano 20 settimane, 5 giorni (A-B-C-D-E)"]
}
```

A **template** is `{parts: [...]}`: text pieces and load tokens. A load token renders as
`round(max[lift] × pct / step) × step`, formatted Italian-style (`112,5`).

## What isn't in the model

Things that belong to a *saved* program rather than to its content live in the storage wrapper (`library.js`):
program id (random UUID), display name, revisions `{revisionId, fileName, sha256, importedAt, model}`,
the original file bytes, edited maxes, last week/day, settings.

## History

- **Schema 1** (milestone 3): PL28 shape — `slots` × `weeks` prescriptions, `accessories` with sets per block,
  `phase` per week. `migrate()` upgrades it with `expandV1()`, the same expansion the PL28 parser uses,
  and the upgraded program is saved back.
- **Schema 2**: explicit sessions, week types, coach format.

## Changing the schema

1. Bump `SCHEMA_VERSION` in `src/model.js`.
2. Add a step to `migrate()` that upgrades a v(n−1) model to v(n). Never edit an old step.
3. Add a test that migrates a saved v(n−1) program (see `tests/library.test.js`).
4. Update this file and `VERSIONS.md`.
