// The reading rules and the `overall` layout shared by both formats (decided 2026-10-26, FORMAT.md, FORMAT-COACH.md):
// capitals, day letters, day order, blank rows, unnamed blocks, the week | giorno | tipo layout in PL28, loads in accessori.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx, parseWorkbook, formatIssue } from "../src/parser.js";
import { exportProgram, exportFormats, sameProgram } from "../src/export.js";
import { writeWorkbook } from "../src/xlsx-write.js";
import { session, maxesFor } from "../src/resolve.js";
import { pl28, model, parseEditedPL28 } from "./helpers.js";

const base = pl28();
const same = (r) => { expect(r.errors).toEqual([]); return sameProgram(r.model, base); };
const day = (m, n, letter) => m.weeks.find((w) => w.n === n).days.find((d) => d.letter === letter);

/** PL28 in the new layout, as rows we can change before writing the file. */
async function pl28NewLayout(edit) {
  const d = exportProgram(base, "pl28");
  edit?.(d);
  return parseXlsx(await writeWorkbook(d));
}
const sheet = (d, name) => d.sheets.find((s) => s.name === name);

describe("A1: capitals don't matter in sheet names and headers", () => {
  it("massimali / Overall / ACCESSORI and their headers in any case", () => {
    const r = parseEditedPL28((wb) => {
      for (const [from, to] of [["Massimali", "massimali"], ["overall", "Overall "], ["accessori", "ACCESSORI"]]) {
        wb.SheetNames[wb.SheetNames.indexOf(from)] = to;
        wb.Sheets[to] = wb.Sheets[from];
        delete wb.Sheets[from];
      }
      wb.Sheets["Overall "].A1 = { t: "s", v: "Week" };
      wb.Sheets["Overall "].B1 = { t: "s", v: "FASE" };
      wb.Sheets.ACCESSORI.A1 = { t: "s", v: "giorno" };
      wb.Sheets.ACCESSORI.G1 = { t: "s", v: "serie b1" };
      wb.Sheets.massimali.A6 = { t: "s", v: "TOTALE" };
    });
    expect(same(r)).toBe(true);
  });

  it("two sheets whose names differ only in capitals are an error", () => {
    const r = parseEditedPL28((wb) => { wb.SheetNames.push("Note"); wb.Sheets.Note = wb.Sheets.note; });
    expect(r.errors.map(formatIssue)).toEqual([
      "note: fogli con lo stesso nome (note, Note): ne serve uno solo",
      "Note: fogli con lo stesso nome (note, Note): ne serve uno solo",
    ]);
  });
});

describe("A2: lowercase day letters", () => {
  it("are read as capitals in overall headers and in accessori", () => {
    const r = parseEditedPL28((wb) => {
      wb.Sheets.overall.C1 = { t: "s", v: "Squat stress (a)" };
      const acc = wb.Sheets.accessori;
      for (let row = 2; acc[`A${row}`]?.v; row++) if (acc[`A${row}`].v === "E") acc[`A${row}`] = { t: "s", v: "e" };
    });
    expect(same(r)).toBe(true);
  });
});

describe("A3: days are alphabetical in both formats", () => {
  it("a coach log that starts with day C still lists A before C", () => {
    const log = XLSX.utils.aoa_to_sheet([
      ["Settimana", "Giorno", "Alzata", "Istruzioni", "Serie x rep", "kg/RPE", "carico usato", "Difficoltà", "Note"],
      [1, "C", "panca", "", "5x5", "", "", "", ""],
      [1, "A", "squat", "", "4x5", "", "", "", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, log, "training log");
    const r = parseWorkbook(wb);
    expect(r.errors).toEqual([]);
    expect(r.model.days).toEqual(["A", "C"]);
  });
});

describe("A4: blank rows in overall", () => {
  it("a blank row between blocks is skipped", async () => {
    const r = await pl28NewLayout((d) => {
      const rows = sheet(d, "overall").rows;
      for (let i = rows.length - 1; i > 1; i--) if (rows[i][0] == null) rows.splice(i, 0, []);
    });
    expect(same(r)).toBe(true);
  });

  it("two empty rows in a row end the sheet: anything below is ignored (both formats)", async () => {
    const junk = (d) => sheet(d, "overall").rows.push([], [], ["note a fondo pagina", "non è una settimana"]);
    expect(same(await pl28NewLayout(junk))).toBe(true);
    const coach = model("PL28_coach.xlsx");
    const d = exportProgram(coach, "coach");
    junk(d);
    const r = parseXlsx(await writeWorkbook(d));
    expect(r.errors).toEqual([]);
    expect(sameProgram(r.model, coach)).toBe(true);
  });

  it("a row with only a week type and no week number is an error", async () => {
    const r = await pl28NewLayout((d) => sheet(d, "overall").rows.push([null, null, "scarico"]));
    expect(r.errors.map((e) => e.ref)).toEqual(["overall!A27"]); // header, lift types, 4 block rows, 20 weeks, then this one
  });
});

describe("A5: block rows don't need a name", () => {
  it("PL28: a block row with only variants is Blocco n", () => {
    const r = parseEditedPL28((wb) => { delete wb.Sheets.overall.B8; });
    expect(r.errors).toEqual([]);
    expect(r.model.blocks.map((b) => b.name)).toEqual(["Blocco 1 – Accumulo", "Blocco 2", "Blocco 3 – Forza", "Blocco 4 – Forza massimale + test"]);
  });

  it("PL28 still needs a block row before the first week", () => {
    const r = parseEditedPL28((wb) => { for (const c of "BCDEFGHIJKL") delete wb.Sheets.overall[`${c}2`]; });
    expect(r.errors.map(formatIssue)).toContain("overall!A3: prima della prima settimana serve una riga di blocco (A vuota, nome del blocco in B)");
  });
});

describe("B1–B2: PL28 in the shared overall layout", () => {
  it("week | giorno | tipo | lifts gives the same program as the old week | fase layout", async () => {
    const d = exportProgram(base, "pl28");
    expect(sheet(d, "overall").rows[0].slice(0, 4).map((c) => c.v)).toEqual(["week", "giorno", "tipo", "Squat stress (A)"]);
    expect(same(parseXlsx(await writeWorkbook(d)))).toBe(true);
  });

  it("dates in giorno reach the app, and the program can still be exported as PL28", async () => {
    const r = await pl28NewLayout((d) => { sheet(d, "overall").rows[3][1] = "6-12/10"; }); // row 4 = week 1
    expect(r.errors).toEqual([]);
    expect(r.model.weeks[0].dates).toBe("6-12/10");
    expect(session(r.model, 1, "A", maxesFor(r.model)).dates).toBe("6-12/10");
    expect(exportFormats(r.model)[0].ok).toBe(true);
    expect(sameProgram((await parseXlsx(await writeWorkbook(exportProgram(r.model, "pl28")))).model, r.model)).toBe(true);
  });

  it("the type is read from the tipo column, and a wrong type names that cell", async () => {
    const r = await pl28NewLayout((d) => { sheet(d, "overall").rows[3][2] = "leggera"; });
    expect(r.errors.map((e) => e.ref)).toEqual(["overall!C4"]);
  });

  it("any other B1 header is an error naming both layouts", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.overall.B1 = { t: "s", v: "date" }; });
    expect(r.errors.map(formatIssue)).toEqual(['overall!B1: intestazione attesa "giorno" o "fase", trovato "date"']);
  });
});

describe("B3: loads in accessori", () => {
  const legCurl = (m, n) => day(m, n, "B").items.find((i) => i.name === "Leg curl seduto");
  // Leg curl seduto is accessori row 8 in PL28.xlsx; week 5 is transizione.
  const row = 8;

  it("Intensità as a load formula: kg follow the maxes, and light weeks don't touch it", () => {
    const r = parseEditedPL28((wb) => {
      expect(wb.Sheets.accessori[`B${row}`].v).toBe("Leg curl seduto");
      wb.Sheets.accessori[`F${row}`] = { t: "s", v: "50kg", f: 'MROUND(Massimali!$B$3*0.25,2.5)&"kg"' };
    });
    expect(r.errors).toEqual([]);
    const m = r.model;
    expect(session(m, 6, "B", maxesFor(m)).accessories.find((a) => a.name === "Leg curl seduto").load).toBe("47,5kg");
    expect(session(m, 6, "B", maxesFor(m, { squat: 200 })).accessories.find((a) => a.name === "Leg curl seduto").load).toBe("50kg");
    expect(legCurl(m, 5).load).toEqual(legCurl(m, 6).load); // transizione: −1 set, but no RIR change on a load
    expect(legCurl(m, 5).prescription.parts[0]).toBe("2x8-12");
  });

  it("Rep with a {Squat .3} placeholder", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.accessori[`E${row}`] = { t: "s", v: "8-12 con {Squat .3}kg" }; });
    expect(r.errors).toEqual([]);
    expect(legCurl(r.model, 6).prescription.parts).toEqual(["3x8-12 con ", { lift: "squat", pct: 0.3, step: 2.5 }, "kg"]);
  });

  it("a PL28 file with accessory loads exports as PL28 and comes back the same", async () => {
    const r = parseEditedPL28((wb) => {
      wb.Sheets.accessori[`F${row}`] = { t: "s", v: "50kg", f: 'MROUND(Massimali!$B$3*0.25,2.5)&"kg"' };
      wb.Sheets.accessori[`E${row}`] = { t: "s", v: "8-12 con {Squat .3}kg" };
    });
    expect(exportFormats(r.model)[0].ok).toBe(true);
    const back = parseXlsx(await writeWorkbook(exportProgram(r.model, "pl28")));
    expect(back.errors).toEqual([]);
    expect(sameProgram(back.model, r.model)).toBe(true);
  });

  it("a placeholder naming an unknown lift is an error on that cell", () => {
    const r = parseEditedPL28((wb) => { wb.Sheets.accessori[`F${row}`] = { t: "s", v: "{Curl .5}kg" }; });
    expect(r.errors.map((e) => e.ref)).toEqual([`accessori!F${row}`]);
  });
});
