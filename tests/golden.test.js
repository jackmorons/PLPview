// Golden test (spec §7.1–7.4): importing PL28.xlsx must give the same strings as the approved prototype.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { renderRx, maxesFor, session, fmt } from "../src/resolve.js";
import { fixture, pl28, prototypeData, prototypeResolve, PL27_MEET } from "./helpers.js";

const m = pl28();
const DATA = prototypeData();
const maxes = maxesFor(m, PL27_MEET);
// "apart from decimal formatting": compare numbers as numbers (115 = 115,0 = 115.0).
const norm = (s) => s.replace(/\d+(?:[.,]\d+)?/g, (n) => String(parseFloat(n.replace(",", "."))));

describe("golden test against PL28_standalone.html", () => {
  it("has the same columns in the same order", () => {
    expect(m.slots.map((s) => `${s.name} (${s.day})`)).toEqual(DATA.cols.map((c) => c.h));
  });

  it("resolves every week × column to the prototype's string", () => {
    let compared = 0;
    DATA.cols.forEach((c, si) => {
      c.w.forEach((tpl, wi) => {
        const ours = renderRx(m.prescriptions[wi][si], maxes);
        expect(norm(ours), `${c.h} settimana ${wi + 1}`).toBe(norm(prototypeResolve(tpl, PL27_MEET)));
        compared++;
      });
      expect(m.blocks.map((b) => b.variants[si])).toEqual(c.v);
    });
    expect(compared).toBe(200);
  });

  it("matches the values Excel cached in the file", () => {
    // A second, independent oracle: what Excel itself computed with the file's maxes.
    const ws = XLSX.read(fixture("PL28.xlsx"), { type: "buffer", cellFormula: true }).Sheets.overall;
    let compared = 0;
    for (const [ref, cell] of Object.entries(ws)) {
      if (ref[0] === "!" || cell.f == null) continue;
      const { r, c } = XLSX.utils.decode_cell(ref);
      const wi = m.weeks.findIndex((w) => w.number === ws[XLSX.utils.encode_cell({ r, c: 0 })].v);
      expect(norm(renderRx(m.prescriptions[wi][c - 2], maxes)), ref).toBe(norm(String(cell.v)));
      compared++;
    }
    expect(compared).toBe(97); // every formula cell in PL28's overall sheet
  });

  it("lists the same accessories as the prototype", () => {
    const ours = m.accessories.filter((a) => !a.volumeOnly)
      .map((a) => ({ d: a.day, n: a.name, i: a.instructions, g: a.group, r: a.reps, x: a.intensity, s: a.sets }));
    expect(ours).toEqual(DATA.acc);
  });
});

describe("spot checks", () => {
  const rx = (week, header) => {
    const si = m.slots.findIndex((s) => `${s.name} (${s.day})` === header);
    return renderRx(m.prescriptions[week - 1][si], maxes);
  };
  it("matches the spec's examples", () => {
    expect(rx(1, "Squat stress (A)")).toBe("4x5 + ist. 110kg");
    expect(rx(6, "Panca stress (B)")).toBe("1x1 115kg + 5x3 110kg");
    expect(rx(13, "Stacco stress (B)")).toBe("1-ist.-1-ist. 195kg");
    expect(rx(15, "Stacco stim. (D)")).toBe("3x2 160kg");
  });
  it("recalculates from edited maxes (§7.2)", () => {
    const edited = maxesFor(m, { ...PL27_MEET, squat: 200 });
    expect(renderRx(m.prescriptions[0][0], edited)).toBe("4x5 + ist. 115kg");
  });
  it("formats Italian decimals", () => {
    expect(fmt(112.5)).toBe("112,5");
    expect(fmt(115)).toBe("115");
  });
});

describe("accessories and days (§7.3, §7.4)", () => {
  const names = (s) => s.accessories.map((a) => a.name);

  it("week 1 day A lists the four accessories, not the pull-up row", () => {
    expect(names(session(m, 1, "A", maxes))).toEqual([
      "Affondi", "Leg extension", "Side bend con manubrio", "Side plank gamba in abduzione",
    ]);
  });
  it("week 5 day A shows Affondi with one set less", () => {
    const a = session(m, 5, "A", maxes).accessories.find((x) => x.name === "Affondi");
    expect(`${a.setsThisWeek}×${a.reps}`).toBe("2×8-10");
  });
  it("week 10 day C hides nothing that has more than 1 set", () => {
    const all = m.accessories.filter((a) => a.day === "C" && a.sets[1] > 1);
    expect(names(session(m, 10, "C", maxes))).toEqual(all.map((a) => a.name));
  });
  it("week 20 (TEST) is light too; week 19 (entrata) is not", () => {
    expect(session(m, 20, "A", maxes).light).toBe(true);
    expect(session(m, 19, "A", maxes).light).toBe(false);
  });
  it("day E has no main lifts, 11 accessories in block 1 and the reminder", () => {
    const s = session(m, 1, "E", maxes);
    expect(s.mains).toHaveLength(0);
    expect(s.accessories).toHaveLength(11);
    expect(s.accessoryOnly).toBe(true);
    expect(session(m, 1, "A", maxes).accessoryOnly).toBe(false);
  });
});
