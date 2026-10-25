// Golden test (spec §7.1–7.4): importing PL28.xlsx must give the same strings as the approved prototype.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { render, maxesFor, session, fmt } from "../src/resolve.js";
import { fixture, pl28, prototypeData, prototypeResolve, slotItem, PL27_MEET } from "./helpers.js";

const m = pl28();
const DATA = prototypeData();
const maxes = maxesFor(m, PL27_MEET);
// "apart from decimal formatting": compare numbers as numbers (115 = 115,0 = 115.0).
const norm = (s) => s.replace(/\d+(?:[.,]\d+)?/g, (n) => String(parseFloat(n.replace(",", "."))));

describe("golden test against PL28_standalone.html", () => {
  it("resolves every week × column to the prototype's string, with the prototype's variant", () => {
    let compared = 0;
    for (const c of DATA.cols) {
      c.w.forEach((tpl, wi) => {
        const it = slotItem(m, wi + 1, c.h);
        expect(it, `${c.h} settimana ${wi + 1}`).not.toBeNull();
        expect(norm(render(it.prescription, maxes)), `${c.h} settimana ${wi + 1}`).toBe(norm(prototypeResolve(tpl, PL27_MEET)));
        expect(it.instructions).toBe(c.v[Math.floor(wi / 5)]);
        compared++;
      });
    }
    expect(compared).toBe(200);
  });

  it("matches the values Excel cached in the file", () => {
    const ws = XLSX.read(fixture("PL28.xlsx"), { type: "buffer", cellFormula: true }).Sheets.overall;
    let compared = 0;
    for (const [ref, cell] of Object.entries(ws)) {
      if (ref[0] === "!" || cell.f == null) continue;
      const { r, c } = XLSX.utils.decode_cell(ref);
      const n = ws[XLSX.utils.encode_cell({ r, c: 0 })].v;
      const header = ws[XLSX.utils.encode_cell({ r: 0, c })].v;
      expect(norm(render(slotItem(m, n, header).prescription, maxes)), ref).toBe(norm(String(cell.v)));
      compared++;
    }
    expect(compared).toBe(97); // every formula cell in PL28's overall sheet
  });

  it("lists the same accessories as the prototype in a normal week", () => {
    for (const day of m.days) {
      const ours = session(m, 1, day, maxes).accessories.map((a) => [a.name, a.text, a.load]);
      const proto = DATA.acc.filter((a) => a.d === day).map((a) => [a.n, `${a.s[0]}x${a.r}`, a.x]);
      expect(ours, day).toEqual(proto);
    }
  });
});

describe("spot checks", () => {
  const rx = (n, header) => render(slotItem(m, n, header).prescription, maxes);
  it("matches the spec's examples", () => {
    expect(rx(1, "Squat stress (A)")).toBe("4x5 + ist. 110kg");
    expect(rx(6, "Panca stress (B)")).toBe("1x1 115kg + 5x3 110kg");
    expect(rx(13, "Stacco stress (B)")).toBe("1-ist.-1-ist. 195kg");
    expect(rx(15, "Stacco stim. (D)")).toBe("3x2 160kg");
  });
  it("recalculates from edited maxes (§7.2)", () => {
    expect(render(slotItem(m, 1, "Squat stress (A)").prescription, maxesFor(m, { squat: 200 }))).toBe("4x5 + ist. 115kg");
  });
  it("formats Italian decimals", () => {
    expect(fmt(112.5)).toBe("112,5");
    expect(fmt(115)).toBe("115");
  });
});

describe("accessories and days (§7.3, §7.4)", () => {
  const names = (s) => s.accessories.map((a) => a.name);

  it("week 1 day A lists the four accessories, not the pull-up row", () => {
    expect(names(session(m, 1, "A", maxes))).toEqual(["Affondi", "Leg extension", "Side bend con manubrio", "Side plank gamba in abduzione"]);
  });
  it("week 5 (transizione) day A shows Affondi with one set less and RIR +1", () => {
    const a = session(m, 5, "A", maxes).accessories.find((x) => x.name === "Affondi");
    expect([a.text, a.load]).toEqual(["2x8-10", "RIR 3"]);
  });
  it("week 10 day C hides nothing that has more than 1 set", () => {
    expect(names(session(m, 10, "C", maxes))).toEqual(names(session(m, 9, "C", maxes)));
  });
  it("weeks get their type from the file; only transizione/scarico/test reduce sets", () => {
    expect(m.weeks.map((w) => w.type)).toEqual([
      ...Array(4).fill("normale"), "transizione", ...Array(4).fill("normale"), "transizione",
      ...Array(4).fill("normale"), "transizione", "ramping", "ramping", "ramping", "entrata", "test"]);
    const affondi = (n) => session(m, n, "A", maxes).accessories.find((x) => x.name === "Affondi").text;
    expect(affondi(19)).toBe("2x8-10"); // entrata: block 4 has 2 sets, no reduction
    expect(affondi(20)).toBe("1x8-10"); // test: one less
  });
  it("day E has no main lifts, 11 accessories in block 1 and the reminder as banner", () => {
    const s = session(m, 1, "E", maxes);
    expect(s.mains).toHaveLength(0);
    expect(s.accessories).toHaveLength(11);
    expect(s.banner).toBe("Fai E solo se domani non c’è B o D.");
    expect(session(m, 1, "A", maxes).banner).toBeNull();
  });
});
