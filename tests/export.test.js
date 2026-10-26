// v2 export (src/export.js, src/xlsx-write.js) and templates (src/templates.js): every exported file imports
// back to the same program, Excel's cached kg match the app, and the templates import cleanly.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { parseXlsx } from "../src/parser.js";
import { parseFormula } from "../src/parse-common.js";
import { exportProgram, exportFormats, sameProgram, toV1 } from "../src/export.js";
import { writeWorkbook } from "../src/xlsx-write.js";
import { templateWorkbook, exampleModel } from "../src/templates.js";
import { render, maxesFor } from "../src/resolve.js";
import { fixture, model, parseEdited } from "./helpers.js";

const pl27 = () => parseEdited("PL27.xlsx", (wb) => {
  const ws = wb.Sheets["training log 2"];
  for (let row = 438; row <= 468; row++) for (const c of "ABCDEFGHIJ") delete ws[`${c}${row}`];
}).model;

const PROGRAMS = {
  "PL28.xlsx": () => model("PL28.xlsx"),
  "PL28_coach.xlsx": () => model("PL28_coach.xlsx"),
  "example.xlsx": () => parseXlsx(fixtureExample()).model,
  "PL27 (senza la seconda settimana 16)": pl27,
};

function fixtureExample() {
  return fixture("../examples/example.xlsx");
}

async function roundTrip(m, format) {
  return parseXlsx(await writeWorkbook(exportProgram(m, format)));
}

describe("round trip: import → export → import gives the same program", () => {
  for (const [name, load] of Object.entries(PROGRAMS)) {
    for (const format of ["pl28", "coach"]) {
      it(`${name} → formato ${format}`, async () => {
        const m = load();
        if (!exportFormats(m).find((f) => f.format === format).ok) return; // checked separately below
        const r = await roundTrip(m, format);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.model.format).toBe(format);
        expect(sameProgram(r.model, m)).toBe(true);
      });
    }
  }
});

describe("which formats a program can go to", () => {
  it("PL28.xlsx and example.xlsx: both formats", () => {
    for (const m of [model("PL28.xlsx"), PROGRAMS["example.xlsx"]()]) expect(exportFormats(m).every((f) => f.ok)).toBe(true);
  });

  it("PL28_coach.xlsx and PL27: coach only, with the reason", () => {
    const [pl28] = exportFormats(model("PL28_coach.xlsx"));
    expect(pl28.ok).toBe(false);
    expect(pl28.reason).toMatch(/^Il formato PL28 non può descrivere questo programma: .*Esportalo in formato coach\.$/);
    expect(exportFormats(pl27())[0].reason).toMatch(/non ha massimali/);
    expect(() => exportProgram(pl27(), "pl28")).toThrow(/non ha massimali/);
  });

  it("an accessory that changes inside a block can't be PL28", () => {
    const m = structuredClone(model("PL28.xlsx"));
    m.weeks[1].days[0].items.at(-1).prescription = { parts: ["5x5"] };
    expect(toV1(m).error).toMatch(/all'interno di un blocco/);
  });
});

describe("what the exported file contains", () => {
  it("block names survive the coach format (variant row with the name in B)", async () => {
    const r = await roundTrip(model("PL28.xlsx"), "coach");
    expect(r.model.blocks.map((b) => b.name)).toEqual(model("PL28.xlsx").blocks.map((b) => b.name));
  });

  it("Massimali holds the file's maxes and a meta sheet says format 1", async () => {
    const wb = XLSX.read(await writeWorkbook(exportProgram(model("PL28.xlsx"), "pl28")), { type: "array" });
    expect(["B3", "B4", "B5"].map((c) => wb.Sheets.Massimali[c].v)).toEqual(model("PL28.xlsx").lifts.map((l) => l.defaultMax));
    expect([wb.Sheets.meta.A1.v, wb.Sheets.meta.B1.v]).toEqual(["formatVersion", 1]);
  });

  for (const format of ["pl28", "coach"]) {
    it(`every formula's cached value is what the app shows (formato ${format})`, async () => {
      const m = model("PL28.xlsx");
      const wb = XLSX.read(await writeWorkbook(exportProgram(m, format)), { type: "array", cellFormula: true });
      const maxes = maxesFor(m);
      let n = 0;
      for (const name of ["overall", "accessori", "training log"]) {
        const ws = wb.Sheets[name];
        if (!ws) continue;
        for (const [ref, cell] of Object.entries(ws)) {
          if (ref[0] === "!" || cell.f == null) continue;
          expect(cell.v, `${name}!${ref}`).toBe(evaluate(wb, cell.f, m, maxes));
          n++;
        }
      }
      expect(n).toBeGreaterThan(50);
    });
  }

  it("splits text longer than Excel's 255-character limit inside a formula", async () => {
    const m = structuredClone(exampleModel());
    const long = "x".repeat(600);
    m.weeks[0].days[0].items[0].prescription.parts[2] += long; // "4x5 ", load, "kg…"
    const wb = XLSX.read(await writeWorkbook(exportProgram(m, "pl28")), { type: "array", cellFormula: true });
    expect(wb.Sheets.overall.C3.f.match(/"[^"]*"/g).every((s) => s.length <= 257)).toBe(true);
    expect(sameProgram(parseXlsx(await writeWorkbook(exportProgram(m, "pl28"))).model, m)).toBe(true);
  });
});

describe("templates", () => {
  for (const format of ["pl28", "coach"]) {
    it(`formato ${format}: imports cleanly as the one-week example`, async () => {
      const r = parseXlsx(await writeWorkbook(templateWorkbook(format)));
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.model.format).toBe(format);
      expect(r.model.weeks).toHaveLength(1);
      expect(r.model.days).toEqual(["A", "B", "C"]);
      expect(r.model.notes[1]).toBe("COME SI COMPILA"); // the note sheet holds the instructions (empty rows skipped)
      expect(sameProgram({ ...r.model, notes: [] }, exampleModel())).toBe(true);
    });

    it(`formato ${format}: week-type dropdown, instructions and yellow example cells`, async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await writeWorkbook(templateWorkbook(format)));
      const ov = wb.getWorksheet("overall");
      const typeCell = format === "pl28" ? "B3" : "C3";
      expect(ov.getCell(typeCell).dataValidation.formulae[0]).toMatch(/normale,scarico,transizione/);
      expect(wb.getWorksheet("note").getCell("A3").value).toBe("COME SI COMPILA");
      expect(ov.getCell("A3").fill.fgColor.argb).toBe("FFFFF2CC");
      expect(wb.getWorksheet("Massimali").getCell("B3").fill.fgColor.argb).toBe("FFFFF2CC");
    });
  }
});

/** What Excel would show for a formula in the exported file: a load formula or an overall reference. */
function evaluate(wb, f, m, maxes) {
  const ref = /^overall!([A-Z]+\d+)$/.exec(f);
  if (ref) return wb.Sheets.overall[ref[1]].v;
  if (/^SUM\(/.test(f)) return m.lifts.reduce((a, l) => a + l.defaultMax, 0);
  const parts = parseFormula(f).parts.map((p) => (typeof p === "string" ? p : { lift: m.lifts[p.row - 3].id, pct: p.pct, step: p.step }));
  return render({ parts }, maxes);
}
