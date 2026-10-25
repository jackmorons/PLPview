# Import format: coach (PL27 layout)

The contract for coach-format files. **`fixtures/PL28_coach.xlsx` is the reference implementation.**
The original brief is in `FORMAT-COACH-SPEC.md`; where this file differs, this file is what the parser does
(differences listed at the end). The PL28 format is in `FORMAT.md`; both produce the same program model.

**In this format every session is written out**, one row per exercise, so accessories, sets, reps and intensity
can change from week to week. What you see in the sheet is what the app shows: no automatic set rules.

**The file is either accepted completely or rejected**, with every problem listed by sheet, cell and reason.

## Which format is it?

| Workbook has | Read as |
|---|---|
| an `accessori` sheet | PL28 format (any `training log` sheet is then the athlete's log and is ignored) |
| no `accessori`, one sheet whose name starts with `training log` | coach format |
| no `accessori`, two or more `training log…` sheets | error |
| neither | error |

## Sheets

| Sheet | Required | Role |
|---|---|---|
| `training log…` (e.g. `training log`, `training log 2`) | yes | **The program.** Sessions are read only from here |
| `overall` | no | Week types, dates, blocks; holds main-lift cells the log points at |
| `Massimali` | no | As in the PL28 format. Without it loads are fixed text and the app hides the max editor |
| `note` | no | Free text, column A, shown in the Note tab |
| anything else | ignored | |

## `training log`

**Row 1**, matched after trimming, ignoring capitals, in this order:

| Col | Header | Content |
|---|---|---|
| A | `Settimana` | week number, integer ≥ 1 (`1` or `1.0`) |
| B | `Giorno` | one letter (made uppercase) |
| C | `Alzata` | exercise name, required |
| D | `Istruzioni` | variant or execution cue, may be empty |
| E | `Serie x rep` | prescription, may hold a load (`4x5 + ist. 110kg`) |
| F | `kg/RPE` | load or intensity (`100kg`, `RIR 2`, `@7/8`), may be empty |
| G | `carico usato` | athlete's column: **ignored completely** |
| H | `Difficoltà` | athlete's column: **ignored completely** |
| I | `Note` | note, see below |
| J | `Gruppo` | optional: `Fondamentale` or a muscle group |

Columns after J are ignored. A J header other than `Gruppo` is ignored with a warning.

**Rows**
- From row 2 to the last row with something in A, B or C. Rows with A, B and C all empty are separators and are skipped.
- Weeks never go back down the sheet.
- Each week + day is **one run of rows** (blank separator rows inside it are fine). The same week + day appearing
  again later is an error naming both rows: `settimana 16 giorno A ripetuta alle righe 408 e 439`.
- Weeks are numbered 1, 2, 3… with no gaps; each week has at least one day.
- Days are shown in the order they first appear in week 1, then any other letters alphabetically.
  Items are shown in row order.

**Cell values** (D, E, F, I):
1. **Plain text**, shown as written. Load placeholders `{Squat .57}kg` work as in the PL28 format (full lift name).
2. **A load formula**: `="4x5 "&MROUND(Massimali!$B$3*0.57,2.5)&"kg"`, same grammar as the PL28 format.
3. **A reference to one `overall` cell**: `=overall!D3` (any `$` style). The referenced cell is read the same way,
   so it can hold text, a load formula or another reference. A reference to an empty cell is an empty value.
4. Anything else is an error naming the cell. The value Excel cached is never used.

Numbers are shown in Italian format (`110`, `112,5`). D (instructions) can't contain loads.

**Main lift or accessory**
- J filled: `Fondamentale` → main lift; anything else → accessory in that group.
- J empty or missing: a name starting with `squat`, `panca`, `stacco` or `trazioni` → main lift; otherwise accessory with no group.
- Main lifts whose name starts with `trazioni` get no plate diagram (the load is added to bodyweight).
  The diagram uses the heaviest `NNkg` in E, otherwise in F.

**Notes**: a day's first note is shown as a banner on that session; every other note is shown under its exercise.

## `overall` (optional)

- `A1 = week`, `B1 = giorno` (week dates as free text, e.g. `6-12 /10`).
- An optional column headed `tipo` holds the **week type** (see below). It isn't a lift column.
- Other headed columns are lift columns; empty columns between them are allowed.
- **Variant row**: A and B empty, some text in a lift column. It starts a new block (`Blocco 1`, `Blocco 2`, …).
- **Week row**: A = week number; B = optional dates; lift cells as in the log (text, load formula, reference).
  Every lift cell is checked, even if the log doesn't point at it.
- Weeks present in `overall` but not in the log (or the reverse) are listed as **warnings**, not errors.

## Week types (both formats)

One fixed list, matched ignoring capitals and spaces at the ends; empty = `normale`. Anything else is an error
naming the cell. Coach format: `overall` column `tipo`. PL28 format: `overall` column B `fase`.

| Type | Badge | Meaning shown as banner |
|---|---|---|
| `normale` | — | — |
| `scarico` | SCAR | volume and intensity clearly down |
| `transizione` | TRANS | light week between blocks |
| `ramping` | RAMP | intensity rising week to week toward a heavy target |
| `intensificazione` | INT | high intensity, lower volume |
| `picco` | PICCO | heaviest singles of the block |
| `taper` | TAPER | pre-meet reduction |
| `entrata` | ENTR | opener practice |
| `test` | TEST | max testing |
| `gara` | GARA | meet week |

**In this format the type never changes sets or loads.** In the PL28 format, `transizione`, `scarico` and `test`
weeks get one accessory set less and RIR +1.

## Differences from `FORMAT-COACH-SPEC.md` (decided 2026-10-25)

1. **Format detection**: `accessori` wins over `training log`, because `PL28.xlsx` has both sheets.
2. **Placeholders** use the full lift name (`{Squat .57}`), not a letter, as in the PL28 format.
3. **Same-sessions test**: main-lift names aren't compared (`Squat stress` in PL28 vs `squat` in the log), and an
   intensity of `—` counts as empty.
4. **Blocks** don't store variants (the log's `Istruzioni` already carries them per session), so PL27's two
   `Panca rig.` columns don't collide.
5. The day's banner note isn't repeated under its exercise.
