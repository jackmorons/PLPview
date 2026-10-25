// Parser tests: PL28 structure (spec §7.4) and rejections (spec §7.5).
import { describe, it, expect } from "vitest";
import { parseXlsx, parseFormula, formatIssue } from "../src/parser.js";
import { fixture, pl28, parseEditedPL28 } from "./helpers.js";

describe("PL28 structure", () => {
  const m = pl28();

  it("reads lifts, blocks, weeks and phases from the file", () => {
    expect(m.lifts).toEqual([
      { id: "squat", name: "Squat", max: 192.5 },
      { id: "panca", name: "Panca", max: 130 },
      { id: "stacco", name: "Stacco", max: 220 },
    ]);
    expect(m.blocks.map((b) => b.name)).toEqual([
      "Blocco 1 – Accumulo", "Blocco 2 – Intensificazione", "Blocco 3 – Forza", "Blocco 4 – Forza massimale + test",
    ]);
    expect(m.weeks).toHaveLength(20);
    expect(m.weeks.filter((w) => w.phase).map((w) => [w.number, w.phase])).toEqual([
      [5, "transizione"], [10, "transizione"], [15, "transizione"], [19, "entrata"], [20, "TEST"],
    ]);
    expect(m.weeks.map((w) => w.block)).toEqual([0,0,0,0,0, 1,1,1,1,1, 2,2,2,2,2, 3,3,3,3,3]);
  });

  it("gets days A–E, with E from accessori only", () => {
    expect(m.days).toEqual(["A", "B", "C", "D", "E"]);
    expect(m.slots.filter((s) => s.day === "E")).toHaveLength(0);
  });

  it("stores formulas as templates and plain text as text", () => {
    expect(m.prescriptions[0][0]).toEqual({ parts: ["4x5 + ist. ", { lift: "squat", pct: 0.57, step: 2.5 }, "kg"] });
    expect(m.prescriptions[0][2]).toEqual({ parts: ["4@7 + 90% 3x4"] });
  });

  it("marks the pull-up accessory row as volume-only and reads the notes", () => {
    expect(m.accessories.filter((a) => a.volumeOnly).map((a) => a.name)).toEqual(["Trazioni zavorrate"]);
    expect(m.accessories).toHaveLength(34);
    expect(m.notes[0]).toBe("PL28 – piano 20 settimane, 5 giorni (A-B-C-D-E)");
  });
});

describe("formula grammar", () => {
  it("accepts strings, loads, escaped quotes, spaces and any $ style", () => {
    expect(parseFormula('="1x1 "&MROUND(Massimali!$B$4*0.885,2.5)&"kg"').parts)
      .toEqual(["1x1 ", { row: 4, pct: 0.885, step: 2.5 }, "kg"]);
    expect(parseFormula('MROUND( Massimali!B3 * .6 , 2.5 ) & "kg ""x"""').parts)
      .toEqual([{ row: 3, pct: 0.6, step: 2.5 }, 'kg "x"']);
  });
  it("rejects anything else", () => {
    for (const f of ["B3*2", '"a"&B3', "MROUND(Massimali!$B$3*0.5,2.5)+1", '"open', "ROUND(Massimali!$B$3*0.5,2.5)", ""]) {
      expect(parseFormula(f).error, f).toBeTruthy();
    }
  });
});

describe("text tokens", () => {
  it("turns {Squat .57} in plain text into a load", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.E3 = { t: "s", v: "4@7 + 90% 3x4 ({Squat .57}kg, {stacco 0,5}kg)" }; });
    expect(r.ok).toBe(true);
    expect(r.model.prescriptions[0][2].parts).toEqual([
      "4@7 + 90% 3x4 (", { lift: "squat", pct: 0.57, step: 2.5 }, "kg, ", { lift: "stacco", pct: 0.5, step: 2.5 }, "kg)",
    ]);
  });
  it("rejects a token naming a lift that isn't in Massimali", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.E3 = { t: "s", v: "{Sqaut .57}kg" }; });
    expect(r.ok).toBe(false);
    expect(r.errors.map(formatIssue)).toEqual(['overall!E3: segnaposto "{Sqaut .57}": nessuna alzata "Sqaut" in Massimali']);
  });
});

describe("rejections (spec §7.5)", () => {
  const refs = (r) => r.errors.map((e) => e.ref);

  it("rejects PL27 with sheet-level errors", () => {
    const r = parseXlsx(fixture("PL27.xlsx"));
    expect(r.ok).toBe(false);
    expect(refs(r)).toEqual(expect.arrayContaining(["Massimali", "accessori", "overall!B1"]));
  });

  it("names the broken accessori header", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.accessori.C1 = { t: "s", v: "Istruzione" }; });
    expect(r.ok).toBe(false);
    expect(refs(r)).toEqual(["accessori!C1"]);
  });

  it("names a non-integer week, and accepts 1.0", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.A9 = { t: "n", v: 6.5 }; });
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain("overall!A9");
    expect(parseEditedPL28((wb) => { wb.Sheets.overall.A9 = { t: "s", v: "6.0" }; }).ok).toBe(true);
  });

  it("names a MROUND pointing at a row that isn't a max", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.D3.f = 'MROUND(Massimali!$B$9*0.6,2.5)&"kg"'; });
    expect(r.ok).toBe(false);
    expect(refs(r)).toEqual(["overall!D3"]);
  });

  it("names a formula outside the grammar", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.D7 = { t: "n", v: 385, f: "B3*2" }; });
    expect(r.ok).toBe(false);
    expect(r.errors.map(formatIssue)[0]).toMatch(/^overall!D7: formula non riconosciuta/);
  });

  it("rejects weeks that skip a number, merged cells and a Serie B count mismatch", () => {
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall.A12 = { t: "n", v: 10 }; }))).toContain("overall!A12");
    expect(refs(parseEditedPL28((wb) => { wb.Sheets.overall["!merges"] = [{ s: { r: 2, c: 7 }, e: { r: 3, c: 7 } }]; }))).toContain("overall!H3:H4");
    expect(refs(parseEditedPL28((wb) => { delete wb.Sheets.accessori.J1; }))).toEqual(["accessori!I1"]);
  });

  it("warns, but accepts, an unknown phase", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.B5 = { t: "s", v: "deload" }; });
    expect(r.ok).toBe(true);
    expect(r.warnings.map(formatIssue)).toEqual(['overall!B5: fase "deload" non riconosciuta: viene mostrata così com\'è']);
  });

  it("rejects a format version newer than the app", () => {
    const r = parseEditedPL28((wb) => {
      wb.SheetNames.push("meta");
      wb.Sheets.meta = { "!ref": "A1:B1", A1: { t: "s", v: "formatVersion" }, B1: { t: "n", v: 2 } };
    });
    expect(refs(r)).toEqual(["meta!B1"]);
  });
});
