// PL28 format: structure (spec §7.4), formula grammar, rejections (§7.5), week types (FORMAT-COACH-SPEC §9).
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx, parseFormula, formatIssue } from "../src/parser.js";
import { readV1 } from "../src/parse-pl28.js";
import { migrate } from "../src/model.js";
import { fixture, pl28, parseEditedPL28, slotItem } from "./helpers.js";

describe("PL28 structure", () => {
  const m = pl28();

  it("reads lifts, blocks and days", () => {
    expect(m.format).toBe("pl28");
    expect(m.lifts).toEqual([
      { id: "squat", name: "Squat", defaultMax: 192.5 },
      { id: "panca", name: "Panca", defaultMax: 130 },
      { id: "stacco", name: "Stacco", defaultMax: 220 },
    ]);
    expect(m.blocks).toEqual([
      { name: "Blocco 1 – Accumulo", firstWeek: 1, lastWeek: 5 },
      { name: "Blocco 2 – Intensificazione", firstWeek: 6, lastWeek: 10 },
      { name: "Blocco 3 – Forza", firstWeek: 11, lastWeek: 15 },
      { name: "Blocco 4 – Forza massimale + test", firstWeek: 16, lastWeek: 20 },
    ]);
    expect(m.days).toEqual(["A", "B", "C", "D", "E"]);
    expect(m.weeks).toHaveLength(20);
  });

  it("stores formulas as templates and plain text as text", () => {
    expect(slotItem(m, 1, "Squat stress (A)").prescription).toEqual({ parts: ["4x5 + ist. ", { lift: "squat", pct: 0.57, step: 2.5 }, "kg"] });
    expect(slotItem(m, 1, "Squat stim. (D)").prescription).toEqual({ parts: ["4@7 + 90% 3x4"] });
  });

  it("keeps the notes", () => {
    expect(m.notes[0]).toBe("PL28 – piano 20 settimane, 5 giorni (A-B-C-D-E)");
  });

  it("migrating a program saved in schema 1 gives the same model as importing", () => {
    const wb = XLSX.read(fixture("PL28.xlsx"), { type: "buffer", cellFormula: true });
    const v1 = readV1(wb, () => { throw new Error("unexpected error"); });
    // How milestone 3 saved it: `phase` ("", "TEST"…) instead of `type`, `max` instead of `defaultMax`.
    const saved = {
      schemaVersion: 1, ...v1,
      lifts: v1.lifts.map(({ defaultMax, ...l }) => ({ ...l, max: defaultMax })),
      weeks: v1.weeks.map(({ type, ...w }) => ({ ...w, phase: type === "normale" ? "" : type === "test" ? "TEST" : type })),
    };
    expect(migrate(JSON.parse(JSON.stringify(saved)))).toEqual(m);
  });
});

describe("formula grammar", () => {
  it("accepts strings, loads, escaped quotes, spaces and any $ style", () => {
    expect(parseFormula('="1x1 "&MROUND(Massimali!$B$4*0.885,2.5)&"kg"').parts).toEqual(["1x1 ", { row: 4, pct: 0.885, step: 2.5 }, "kg"]);
    expect(parseFormula('MROUND( Massimali!B3 * .6 , 2.5 ) & "kg ""x"""').parts).toEqual([{ row: 3, pct: 0.6, step: 2.5 }, 'kg "x"']);
  });
  it("rejects anything else", () => {
    for (const f of ["B3*2", '"a"&B3', "MROUND(Massimali!$B$3*0.5,2.5)+1", '"open', "ROUND(Massimali!$B$3*0.5,2.5)", ""]) {
      expect(parseFormula(f).error, f).toBeTruthy();
    }
  });
});

describe("text placeholders", () => {
  it("turns {Squat .57} in plain text into a load", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.E3 = { t: "s", v: "4@7 + 90% 3x4 ({Squat .57}kg, {stacco 0,5}kg)" }; });
    expect(r.ok).toBe(true);
    expect(slotItem(r.model, 1, "Squat stim. (D)").prescription.parts).toEqual([
      "4@7 + 90% 3x4 (", { lift: "squat", pct: 0.57, step: 2.5 }, "kg, ", { lift: "stacco", pct: 0.5, step: 2.5 }, "kg)",
    ]);
  });
  it("rejects a placeholder naming a lift that isn't in Massimali", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.E3 = { t: "s", v: "{Sqaut .57}kg" }; });
    expect(r.errors.map(formatIssue)).toEqual(['overall!E3: segnaposto "{Sqaut .57}": nessuna alzata "Sqaut" in Massimali']);
  });
});

describe("rejections (spec §7.5)", () => {
  const refs = (r) => r.errors.map((e) => e.ref);

  it("names the broken accessori header", () => {
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.accessori.C1 = { t: "s", v: "Istruzione" }; }))).toEqual(["accessori!C1"]);
  });
  it("names a non-integer week, and accepts 1.0", () => {
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall.A9 = { t: "n", v: 6.5 }; }))).toContain("overall!A9");
    expect(parseEditedPL28((wb) => { wb.Sheets.overall.A9 = { t: "s", v: "6.0" }; }).ok).toBe(true);
  });
  it("names a MROUND pointing at a row that isn't a max", () => {
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall.D3.f = 'MROUND(Massimali!$B$9*0.6,2.5)&"kg"'; }))).toEqual(["overall!D3"]);
  });
  it("names a formula outside the grammar", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.D7 = { t: "n", v: 385, f: "B3*2" }; });
    expect(r.errors.map(formatIssue)[0]).toMatch(/^overall!D7: formula non riconosciuta/);
  });
  it("rejects weeks that skip a number, merged cells and a Serie B count mismatch", () => {
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall.A12 = { t: "n", v: 10 }; }))).toContain("overall!A12");
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall["!merges"] = [{ s: { r: 2, c: 7 }, e: { r: 3, c: 7 } }]; }))).toContain("overall!H3:H4");
    expect(refs(parseEditedPL28((wb) => { delete wb.Sheets.accessori.J1; }))).toEqual(["accessori!I1"]);
  });
  it("rejects a format version newer than the app", () => {
    const r = parseEditedPL28((wb) => {
      wb.SheetNames.push("meta");
      wb.Sheets.meta = { "!ref": "A1:B1", A1: { t: "s", v: "formatVersion" }, B1: { t: "n", v: 2 } };
    });
    expect(refs(r)).toEqual(["meta!B1"]);
  });
  it("rejects a file that is neither format", () => {
    const r = parseEditedPL28((wb) => { wb.SheetNames = wb.SheetNames.filter((s) => s !== "accessori" && s !== "training log"); delete wb.Sheets.accessori; delete wb.Sheets["training log"]; });
    expect(refs(r)).toEqual(["file"]);
  });
});

describe("week types in the PL28 format (§9)", () => {
  it("rejects an unknown type, naming the cell", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.B5 = { t: "s", v: "leggera" }; });
    expect(r.errors.map(formatIssue)).toEqual(['overall!B5: tipo di settimana "leggera" non valido: usa normale, scarico, transizione, ramping, intensificazione, picco, taper, entrata, test, gara']);
  });
  it("reads empty as normale and ignores case", () => {
    const r = parseEditedPL28((wb) => { delete wb.Sheets.overall.B3; wb.Sheets.overall.B4 = { t: "s", v: " Ramping " }; });
    expect(r.model.weeks.slice(0, 2).map((w) => w.type)).toEqual(["normale", "ramping"]);
  });
  it("week 7 as scarico gets one accessory set less (and RIR +1)", () => {
    const before = pl28().weeks[6].days.find((d) => d.letter === "B").items.find((i) => i.name === "Leg curl seduto");
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.B10 = { t: "s", v: "scarico" }; });
    const after = r.model.weeks[6].days.find((d) => d.letter === "B").items.find((i) => i.name === "Leg curl seduto");
    expect([before.prescription.parts[0], before.load.parts[0]]).toEqual(["3x8-12", "RIR 1"]);
    expect([after.prescription.parts[0], after.load.parts[0]]).toEqual(["2x8-12", "RIR 2"]);
  });
});
