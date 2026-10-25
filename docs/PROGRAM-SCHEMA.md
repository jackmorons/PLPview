# Program model, schema version 1

The xlsx is only how a program gets **in**. What the app stores, validates and renders is this JSON model.
The parser (`src/parser.js`) produces it; v2's xlsx exporter and v3's editor will read and write it.
The rules on it live in `validateProgram()` in `src/model.js`, so every source obeys the same rules.

```jsonc
{
  "schemaVersion": 1,

  // Massimali. id = the name in lower case; used by load tokens and by saved maxes.
  "lifts": [ { "id": "squat", "name": "Squat", "max": 192.5 } ],

  // One per block row in overall. variants[i] belongs to slots[i].
  "blocks": [ { "name": "Blocco 1 – Accumulo", "variants": ["discesa 4''", "HB discesa 3''", "…"] } ],

  // number: 1, 2, 3… phase: "" | "transizione" | "entrata" | "TEST" | any other text (shown as is).
  // block: index into blocks.
  "weeks": [ { "number": 1, "phase": "", "block": 0 } ],

  // Sorted day letters: from slot headers plus accessori.
  "days": ["A", "B", "C", "D", "E"],

  // One per overall column from C. The header is `${name} (${day})`.
  "slots": [ { "name": "Squat stress", "day": "A" } ],

  // prescriptions[weekIndex][slotIndex]: null = not trained (hidden),
  // or a list of parts: text, or a load token computed at render time.
  "prescriptions": [[
    { "parts": ["4x5 + ist. ", { "lift": "squat", "pct": 0.57, "step": 2.5 }, "kg"] },
    { "parts": ["4@7 + 90% 3x4"] },
    null
  ]],

  // sets[blockIndex]: integer ≥ 0. volumeOnly: counted for volume, not listed.
  "accessories": [ {
    "day": "A", "name": "Affondi", "instructions": "parti con lato debole", "group": "Quadricipiti",
    "reps": "8-10", "intensity": "RIR 2", "sets": [3, 3, 3, 2], "volumeOnly": false
  } ],

  // Paragraphs from the note sheet.
  "notes": ["PL28 – piano 20 settimane, 5 giorni (A-B-C-D-E)"]
}
```

Rendering a load token: `round(max[lift] × pct / step) × step`, formatted Italian-style (`112,5`).

## What isn't in the model

Things that belong to a *saved* program rather than to its content live in the storage wrapper
(milestone 4): program id (random UUID), display name, revisions `{revisionId, fileName, sha256, importedAt, model}`,
the original file bytes, edited maxes, last week/day, settings.

## Changing the schema

1. Bump `SCHEMA_VERSION` in `src/model.js`.
2. Add a step to `migrate()` that upgrades a v(n−1) model to v(n). Never edit an old step.
3. Add a test that migrates a saved v(n−1) program.
4. Update this file and `VERSIONS.md`.

Programs Jack has already saved must always keep opening.
