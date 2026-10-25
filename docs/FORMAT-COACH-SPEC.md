# Coach format (layout PL27): import spec

**Status:** new import format, to sit alongside the PL28 format already implemented.
**Fixtures:**
- `PL28_coach.xlsx`: PL28's full content written in this layout. Golden fixture.
- `PL27.xlsx`: the coach's real previous file. Close to this format but not valid (see §7).

**Why:** Jack's coach writes programs in this layout. In it, **every session is written out in full**, so complementaries, sets, reps and intensity can change from week to week. The PL28 format can't do that: its accessories are fixed per block, and only squat/bench/deadlift vary.

---

## 1. First, change the data model (schema v2)

The current program model stores accessories once per block, plus a "−1 set in light weeks" rule. That can't hold this format. Change it to **explicit sessions**:

```js
program = {
  schemaVersion: 2,
  lifts: [{ id, name, defaultMax, sourceRow? }],
  weeks: [{
    n, label?, dates?, block?,
    days: [{
      letter,
      items: [{
        kind: "main" | "acc",
        name,                 // "squat", "Affondi"
        instructions,         // variant / execution cue
        prescription,         // template: text pieces + load tokens
        load,                 // template or null (kg/RPE column)
        group,                // "Fondamentale", "Dorsali", …, or null
        note                  // coach note or null
      }]
    }]
  }],
  blocks: [{ name, firstWeek, lastWeek, variants?: {slotName: text} }],   // optional, for grouping the week picker
  notes: [text]
}
```

- `migrate()`: v1 → v2 expands the PL28-format data into explicit sessions. Each block's sets become per-week items; in `transizione`/`TEST` weeks apply −1 set and RIR +1 during the expansion and write the result into the items.
- **The PL28-format parser stays.** It now outputs schema v2 by doing the same expansion. Both formats then produce the same shape, and the UI reads only `weeks[].days[].items[]`.
- **Regression test:** importing `PL28.xlsx` (old format) and `PL28_coach.xlsx` (this format) must give the same sessions. For every week/day the item list must match in order, kind, name, instructions, resolved prescription, resolved load, group and sets. Notes may differ.
- **Detecting the format:**
  - Workbook has an `accessori` sheet → PL28 format.
  - A sheet whose name starts with `training log` → coach format.
  - Both or neither → error.

---

## 2. Sheets

| Sheet | Required | Role |
|---|---|---|
| `training log*` (name **starts with** `training log`, e.g. `training log`, `training log 2`) | yes | **The program.** The only sheet sessions are read from |
| `overall` | no (recommended) | Main-lift summary, kept by the coach. Used for (a) cell references from the log, (b) week dates, (c) block grouping and variants |
| `Massimali` | no | Same rules as the PL28 format (§3.2 of the spec). Without it the program has no lifts to scale from: loads are fixed text and the app's max editor is hidden for that program (the RPE/plate tools still work with maxes entered there) |
| `note` | no | Free text, column A |
| anything else | ignored | |

If more than one sheet name starts with `training log`, that's an error.

---

## 3. `training log`: the program

### 3.1 Columns

Row 1 headers, **matched exactly after trimming and case-insensitively**, in this order:

| Col | Header | Required | Used for |
|---|---|---|---|
| A | `Settimana` | yes | Week number |
| B | `Giorno` | yes | Day letter |
| C | `Alzata` | yes | Exercise name |
| D | `Istruzioni` | yes | Variant / execution cue (may be empty) |
| E | `Serie x rep` | yes | Prescription (may hold a load too, e.g. `4x5 + ist. 110kg`) |
| F | `kg/RPE` | yes | Load or intensity (`100kg`, `RIR 2`, `@7/8`, `carico 4@7 sett. prec.`); may be empty |
| G | `carico usato` | yes | **Athlete input. Ignore it.** |
| H | `Difficoltà` | yes | **Athlete input. Ignore it.** |
| I | `Note` | yes | Shown as the item's note |
| J | `Gruppo` | **no** | `Fondamentale` or a muscle group; used for main/accessory classification and the volume view |

- Columns after J are ignored.
- If J is missing, the parser still accepts the file (PL27 has no J) and classifies by name (§3.4).

### 3.2 Rows

- Data starts at row 2 and runs to the **last** row where any of A, B or C is filled.
- **Blank rows** (A, B and C all empty) are separators and are skipped. PL27 and the template have one between every day. Don't stop reading at them.
- **Ignore all athlete-input columns (G, H) completely, including in validation.** `MANCA`, emoji and so on must never cause an error.
- `Settimana`: an integer ≥ 1, written as `1` or `1.0`. Anything else is an error.
- `Giorno`: one letter A–Z, trimmed and made uppercase.
- `Alzata`: must not be empty.
- **Structure rules** (all errors, each naming the offending row):
  1. Week numbers never decrease going down the sheet.
  2. Each (week, day) pair appears as **one contiguous run** of rows. If the same week+day turns up again later, that's an error ("settimana 16 giorno A ripetuta alle righe 384 e 412"). Note that PL27 breaks this rule.
  3. Weeks run consecutively from 1 to N with no gaps. Every week must have at least one day.
  4. Day letters within a week may appear in any order; keep the sheet's order. The app shows days in the order they first appear in week 1, and adds any extra letters alphabetically.
- **Item order** inside a day = row order. Show it exactly that way.

### 3.3 Cell values

Each of E, F and I can be:
1. **Plain text** (trim it, convert non-breaking spaces). `{S.57}`-style tokens are allowed, as in the PL28 format.
2. **A load formula**, using the same grammar as the PL28 format:
   ```
   ="text"&MROUND(Massimali!$B$<row>*<pct>,<step>)&"kg"
   ```
3. **A reference to one cell in `overall`:** `=overall!<CELL>`, with optional `$`. Resolve it by reading the referenced cell **recursively**: if that cell is text, use the text; if it's a load formula, use the template. The template's SBD rows are all built this way, e.g. `E2 = =overall!C3`. A reference to an empty cell gives an empty value.
4. Any other formula is an **error** with the cell named. Never fall back to the cached value.

A numeric cell (e.g. `90` in F) becomes text: format it, and append nothing.

### 3.4 Main vs accessory (`kind`)

1. If column J exists and isn't empty: `Fondamentale` → `main`; anything else → `acc`, with `group` = J.
2. Otherwise (no J column, or J empty on that row): `main` if `Alzata`, lowercased and trimmed, matches `^(squat|panca|stacco|trazioni)\b`; otherwise `acc` with `group = null`.

- A main item whose name starts with `trazioni` gets no plate diagram, because its kg is added to bodyweight.
- The plate diagram uses the heaviest `NNkg` found in E, otherwise in F.

### 3.5 Week type and notes

- **Week type** comes from `overall` column `tipo` (§4 and §9). With no `overall` sheet, or an empty `tipo` cell, the week is `normale`.
- **Notes:** show a day's **first non-empty note** as a banner on that session, and each item's note under the item.
- **Don't add set or load logic based on the week type** in this format. Light weeks are already written out with their real sets (see §5).

---

## 4. `overall` (optional)

The layout follows PL27 exactly:
- `A1 = week`, `B1 = giorno` (week dates, free text such as `6-12 /10`).
- **Optional `tipo` column:**
  - It's the column whose row-1 header is `tipo` (case-insensitive, trimmed); in the template that's `C`. It is **not** a lift slot.
  - It holds the week type (§9) and is read only on week rows.
  - PL27 has no such column, so all its weeks are `normale`.
- After those, lift-slot headers **without** a day letter (`Squat stress.`, `Squat rig`, …). **Empty columns are allowed as separators** between groups and are skipped.
- **Variant row:** a row where A and B are both empty and at least one slot cell has text. It holds the variants from the following week onwards, until the next variant row. A variant row directly under the header row is allowed (PL27 and the template both have one).
- **Week row:** A is an integer (or `n.0`); B is optional dates; the slot cells hold prescriptions in the same three cell types as §3.3.

What the app takes from it:
- `weeks[n].dates` comes from B.
- **Blocks:** each variant row starts a new block, named `Blocco 1…n`. Block ranges group the week picker; with no `overall` sheet the picker is a flat list.
- The cells referenced by the log are read through §3.3 rule 3.

The day each slot belongs to is **not** in `overall`; the app never needs it, because sessions come from the log.

- **Cross-check (warning, not error):** every week number in `overall` should exist in the log, and the other way round. List any mismatches on the import summary screen.

---

## 5. The template (`PL28_coach.xlsx`)

The template is generated by a script (Jack has it) and is PL28 in full:
- **`overall`:** PL27 layout, a variant row per block, and loads as `MROUND` formulas on `Massimali`.
- **`training log`:** 860 exercise rows covering 20 weeks × days A–E, with a blank row between days, as in PL27.
  - Main-lift rows: E is `=overall!…`, F is empty, J is `Fondamentale`.
  - Accessory rows: E is `NxREP` text, F is `RIR …`, J is the muscle group.
  - Weeks 5/10/15/20 already have −1 set and RIR +1.
  - Phase and day-E reminders sit in `Note` on the first row of the day.
- **`Massimali`:** 192.5 / 130 / 220.
- **`note`:** instructions for the coach.

**Accessories may differ each week.** Nothing in the parser or the UI may assume that two weeks have the same accessories.

---

## 6. Volume view with this format

- Count sets for items where `kind = acc` and `group` isn't empty, plus main items whose group is not `Fondamentale`.
- Sets = the number before the first `x` in `Serie x rep` (`3x8-10` → 3; `1x5-7 + 2x8-10` → 3, summing every `Nx`). An item with no `Nx` (e.g. `30RT`, `max`, `EMOM`) counts 0, and the view shows a footnote saying how many items weren't counted.
- Show the totals **per week** (not per block), with a week selector, because weeks can now differ.
- **Known difference from PL28's `volume` sheet:** pull-ups (`Fondamentale` here) aren't counted, so Dorsali shows 4 fewer sets per week than in the PL28 sheet. This is expected; don't "fix" it.

---

## 7. Tests (add these to the existing suite)

1. **Golden:** `PL28_coach.xlsx` imports with 0 errors and gives 20 weeks with days A–E. Spot checks:
   - week 1 A item 1 = `squat` / `discesa 4''` / `4x5 + ist. 110kg`, kind main
   - week 5 A `Affondi` = `2x8-10`, load `RIR 3`
   - week 13 B item 2 = `stacco` / `1-ist.-1-ist. 195kg`
   - week 1 E has 0 main items and 11 accessories, with the day-E reminder as its banner
2. **Same result from both formats:** `PL28.xlsx` and `PL28_coach.xlsx` give the same sessions (§1).
3. **Maxes:** set squat to 200 → week 1 A squat shows `115kg`. This proves the log → overall → Massimali chain recalculates.
4. **Week-specific accessories:** in a copy of the template, change week 7 C to swap `Hip thrust` for `Glute bridge 4x12` → only week 7 C changes; weeks 6 and 8 C are unchanged.
5. **PL27.xlsx is rejected.**
   - The expected error is week 16, days A–D, each appearing twice: first at rows 408–437, again at rows 439–468.
   - Record the parser's full error list in the test, so the behavior is documented.
   - It must **not** report errors about the athlete-input columns (`MANCA`, emoji, text in G/H).
6. **A copy of PL27 with the second week-16 run deleted** imports successfully, even without a J column:
   - squat/panca/stacco/trazioni rows are classified main by name
   - loads are fixed text, and there's no Massimali sheet, so the max editor is hidden
   - blocks come from PL27's `overall` variant rows
7. **Errors:**
   - a non-integer `Settimana`
   - an unknown formula in E (`=B3*2`)
   - `=overall!Z99` pointing at an empty cell (an empty value, not an error)
   - two sheets starting with `training log`
   - a missing `Alzata`
   - Each must give the right message and cell.

---

## 8. Update `VERSIONS.md`

The decision entry is already in `VERSIONS.md` (v1 → Decisions). Add the §7 tests to v1's acceptance list as checkboxes. In **v2**, the template download should offer **both** templates (`PL28 format` and `formato coach`), and "Esporta come xlsx" should let you choose which format to export.

---

## 9. Week types (both formats)

**One fixed list for both import formats**, written in lowercase Italian and matched case-insensitively after trimming. The templates show it as an Excel dropdown. Where it lives:
- PL28 format: `overall` column B `fase`.
- Coach format: `overall` column `tipo`.

| Value | Meaning | App badge |
|---|---|---|
| `normale` (or empty) | Regular training week | no badge |
| `scarico` | Deload: volume and intensity both clearly down | grey |
| `transizione` | Light/transition week between blocks | amber |
| `ramping` | Intensity building week to week toward a heavy target | blue |
| `intensificazione` | High intensity, lower volume | indigo |
| `picco` | Peak: heaviest singles of the block | red |
| `taper` | Pre-meet reduction | teal |
| `entrata` | Opener practice | orange |
| `test` | Max testing | green |
| `gara` | Meet week | gold |

Rules:
- Any other value is an **error** naming the cell and listing the allowed values. Free text would make the badges inconsistent. `TEST` and `Test` are fine because matching is case-insensitive.
- Model: `weeks[n].type` is one of the values above (`normale` when empty).
- **How the app shows it:**
  - a badge on the week button in the picker (a short label: `SCAR`, `TRANS`, `RAMP`, `INT`, `PICCO`, `TAPER`, `ENTR`, `TEST`, `GARA`)
  - a pill in the session header
  - a one-line banner with the meaning from the table above
  - Semantic colors are separate from the accent color, and they must work in both themes.
- **What it does to sets:**
  - **Coach format:** nothing. The sets in the sheet are final.
  - **PL28 format:** the existing −1 set / RIR +1 expansion applies to weeks typed `transizione`, `scarico` or `test`. This replaces the old hard-coded rule.
- Optional filter in the week picker: "mostra solo settimane di tipo…".
- PL28 values in both templates: weeks 5/10/15 `transizione`, 16–18 `ramping`, 19 `entrata`, 20 `test`, all others `normale`.

Add tests:
- an unknown type (`leggera`) is rejected with the cell named
- empty → `normale`
- both PL28 templates give identical `weeks[].type`
- in the PL28 format, changing week 7 to `scarico` reduces its accessory sets by 1
